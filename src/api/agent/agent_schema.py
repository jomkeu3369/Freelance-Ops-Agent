from pydantic import BaseModel

from typing import Optional

class FeedbackRequest(BaseModel):
    feedback: str

class StreamRequest(BaseModel):
    message: Optional[str] = None