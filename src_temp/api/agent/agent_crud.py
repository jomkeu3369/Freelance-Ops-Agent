import os
import faiss
import uuid

from typing import Optional, List, Dict

from langchain_core.documents import Document

from langchain_community.vectorstores import FAISS
from langchain_community.docstore.in_memory import InMemoryDocstore
from langchain_community.document_loaders import TextLoader
from langchain_community.retrievers import BM25Retriever

from langchain_text_splitters import RecursiveCharacterTextSplitter

from langchain_openai.embeddings import OpenAIEmbeddings

from src.logs.log import get_logger


class FAISSManager:
    def __init__(self, db_path: str = "faiss_index"):
        self.db_path = db_path
        self.logger = get_logger()

        self.embeddings = OpenAIEmbeddings()
        
        if os.path.exists(self.db_path):
            self.db = FAISS.load_local(
                folder_path=self.db_path, 
                embeddings=self.embeddings, 
                allow_dangerous_deserialization=True
            )
        else:
            self.db = FAISS(
                embedding_function=self.embeddings,
                index=faiss.IndexFlatL2(1536),
                docstore=InMemoryDocstore(),
                index_to_docstore_id={},
            )
        
        self.text_splitter = RecursiveCharacterTextSplitter(chunk_size=600, chunk_overlap=200)

    def add_project_document(self, file_path: str, project_id: str) -> List[str]:
        """문서를 로드, 청크화하여 메타데이터와 함께 추가합니다."""
        
        loader = TextLoader(file_path, encoding="utf-8")
        docs = loader.load()
        
        split_docs = self.text_splitter.split_documents(docs)
        doc_ids = [str(uuid.uuid4()) for _ in split_docs]
        
        for i, doc in enumerate(split_docs):
            doc.metadata["doc_type"] = "project"
            doc.metadata["project_id"] = project_id
            doc.metadata["chunk_index"] = i
            doc.metadata["total_chunks"] = len(split_docs)
            
        self.db.add_documents(split_docs, ids=doc_ids)
        self.db.save_local(self.db_path)
        
        return doc_ids

    def search_documents(self, query: str, k: int = 3, filter_dict: Optional[Dict] = None, distance_threshold: float = 0.4):
        """임계값을 넘지 않는 문서만 반환하고, 디버깅을 위해 점수를 출력합니다."""

        docs_and_scores = self.db.similarity_search_with_score(query, k=k, filter=filter_dict)
        
        valid_docs = []
        for doc, score in docs_and_scores:
            self.logger.info(f"[FAISS 검색 점수] {doc.metadata.get('law_name', '문서')} (Chunk {doc.metadata.get('chunk_index')}): {score:.4f}")
            
            if score <= distance_threshold:
                valid_docs.append(doc)
                
        return valid_docs

    def hybrid_search(self, query: str, k: int = 3, filter_dict: dict = None):
        """ BM25와 FAISS 검색 결과를 RRF(Reciprocal Rank Fusion) 알고리즘으로 결합합니다.
            - 대한민국 법에 근거하여 위반 사항이 있는지 구제척으로 판단하기 위한 자료 검색
        """
        
        all_docs = list(self.db.docstore._dict.values())
        
        if filter_dict:
            filtered_docs = [
                doc for doc in all_docs 
                if all(doc.metadata.get(key) == value for key, value in filter_dict.items())
            ]
        else:
            filtered_docs = all_docs
            
        if not filtered_docs:
            return []

        bm25_retriever = BM25Retriever.from_documents(filtered_docs)
        bm25_retriever.k = min(20, len(filtered_docs)) 
        bm25_docs = bm25_retriever.invoke(query)

        faiss_docs = self.db.similarity_search(query, k=min(20, len(filtered_docs)), filter=filter_dict)
        rrf_score = {}
        
        def add_to_rrf(docs, weight):
            """ RRF 공식: 가중치 * (1 / (순위 + 상수 60)) """

            for rank, doc in enumerate(docs):
                identifier = doc.metadata.get('law_name') or doc.metadata.get('project_id') or 'doc'
                doc_id = f"{identifier}_{doc.metadata.get('chunk_index', 0)}"
                
                if doc_id not in rrf_score:
                    rrf_score[doc_id] = {"doc": doc, "score": 0.0}
                
                rrf_score[doc_id]["score"] += weight * (1 / (rank + 60))

        add_to_rrf(bm25_docs, 0.6)
        add_to_rrf(faiss_docs, 0.4)

        reranked_results = sorted(rrf_score.values(), key=lambda x: x["score"], reverse=True)
        
        for i, item in enumerate(reranked_results[:k]):
            doc_meta = item['doc'].metadata
            self.logger.info(f"{i+1}위. {doc_meta.get('law_name')} Chunk {doc_meta.get('chunk_index')} (RRF 점수: {item['score']:.5f})")
             
        return [item["doc"] for item in reranked_results[:k]]

    def get_full_project_document(self, project_id: str) -> str:
        """ 특정 project_id를 가진 모든 청크를 찾아 chunk_index 순서대로 정렬한 뒤, 하나의 원본 문서로 병합하여 반환합니다.
        """
        all_docs = list(self.db.docstore._dict.values())
        
        project_chunks = [
            doc for doc in all_docs 
            if doc.metadata.get("project_id") == project_id
        ]
        
        if not project_chunks:
            return ""
            
        project_chunks.sort(key=lambda x: x.metadata.get("chunk_index", 0))
        full_text = "\n\n".join([doc.page_content for doc in project_chunks])
        
        return full_text
    
    def add_documents(self, documents: List[Document], ids: List[str] = None):
        """외부에서 Document 리스트를 직접 받아 적재합니다. """

        self.db.add_documents(documents, ids=ids)
        self.db.save_local(self.db_path)
        
    def delete_documents(self, doc_ids: List[str]):
        """문서 ID 리스트를 받아 벡터 DB에서 삭제합니다."""

        if doc_ids:
            self.db.delete(doc_ids)
            self.db.save_local(self.db_path)
            self.logger.info(f"{len(doc_ids)} 개의 청크가 삭제되었습니다.")

    def delete_documents_by_metadata(self, filter_dict: dict):
        """메타데이터 조건을 만족하는 모든 문서를 벡터 DB에서 삭제합니다. """
        
        target_ids = []
        for doc_id, doc in self.db.docstore._dict.items():
            is_match = all(doc.metadata.get(key) == value for key, value in filter_dict.items())
            
            if is_match:
                target_ids.append(doc_id)
                
        if target_ids:
            self.delete_documents(target_ids)

faiss_manager = FAISSManager(db_path="src/data/faiss_index")