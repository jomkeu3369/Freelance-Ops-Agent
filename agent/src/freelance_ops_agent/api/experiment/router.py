import os
import sys

from fastapi import APIRouter, Depends, HTTPException, status
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

router = APIRouter(prefix="/experiment", tags=["experiment"])