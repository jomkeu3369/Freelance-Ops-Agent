from pydantic import BaseModel

class AnalyzeRequest(BaseModel):
    raw_spec_text: str
    client_id: str | None = None