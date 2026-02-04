from datetime import datetime
from pydantic import BaseModel

class ClientCreate(BaseModel):
    client_number: int
    name: str
    status: str = "Active"

class ClientResponse(BaseModel):
    id: str
    client_number: int
    name: str
    status: str
    created_at: datetime