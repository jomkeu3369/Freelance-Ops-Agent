from collections import Counter

from similarity_demo_fixture import build_demo_cases, demo_documents


def test_demo_fixture_is_balanced_and_references_existing_documents() -> None:
    cases = build_demo_cases()

    assert len(demo_documents) == 18
    assert len(cases) == 72
    assert len({case.case_id for case in cases}) == len(cases)
    assert Counter((case.split, case.answerable) for case in cases) == {
        (split, answerable): 12
        for split in ("train", "validation", "test")
        for answerable in (False, True)
    }
    assert all(set(case.relevant_document_ids).issubset(demo_documents) for case in cases)
    assert all(case.llm_accept is not None for case in cases if case.split == "test")
    assert len({case.category for case in cases if case.split == "test"}) >= 15
