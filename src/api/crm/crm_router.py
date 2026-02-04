from typing import List
from fastapi import APIRouter, HTTPException, status

import src.api.crm.crm_crud as crud
from src.api.crm.crm_schema import ClientCreate, ClientResponse

router = APIRouter(prefix="/crm", tags=["crm"])

@router.get("/clients", response_model=List[ClientResponse])
async def get_clients():
    clients = await crud.get_all_clients()
    return [ClientResponse(id=str(c.id), **c.dict()) for c in clients]

@router.post("/clients", response_model=ClientResponse)
async def create_client(client_data: ClientCreate):
    client = await crud.create_client(client_data)
    return ClientResponse(id=str(client.id), **client.dict())

@router.delete("/clients/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_client(client_id: str):
    client = await crud.get_client_by_id(client_id)
    if not client:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Client not found"
        )
    
    await crud.delete_client(client)