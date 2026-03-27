from typing import List

from fastapi import APIRouter, Depends, HTTPException, status

from src.api.crm import crm_crud

from src.api.auth.auth_router import get_current_user
from src.api.crm.crm_schema import ClientCreate, ClientResponse

router = APIRouter(prefix="/crm", tags=["crm"])

@router.get("/clients", response_model=List[ClientResponse])
async def get_clients(current_user = Depends(get_current_user)):
    clients = await crm_crud.get_all_clients()
    
    return [ClientResponse(id=str(c.id), **c.dict(exclude={'id'})) for c in clients]

@router.post("/clients", response_model=ClientResponse)
async def create_client(client_data: ClientCreate, current_user = Depends(get_current_user)):
    client = await crm_crud.create_client(client_data)

    return ClientResponse(id=str(client.id), **client.dict(exclude={'id'}))


@router.get("/clients/{client_id}", response_model=ClientResponse)
async def get_client(client_id: str) -> ClientResponse:
    client = await crud.get_client_by_id(client_id)
    
    if not client:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Client not found"
        )

    return ClientResponse(id=str(client.id), **client.dict(exclude={'id'}))


@router.put("/clients/{client_id}", response_model=ClientResponse)
async def edit_client(client_id: str, client_data: ClientCreate) -> ClientResponse:
    client = await crud.get_client_by_id(client_id)
    
    if not client:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Client not found"
        )

    updated_client = await crud.update_client(client, client_data)

    return ClientResponse(id=str(updated_client.id), **updated_client.dict(exclude={'id'}))


@router.delete("/clients/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_client(client_id: str, current_user = Depends(get_current_user)):
    client = await crm_crud.get_client_by_id(client_id)
    if not client:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Client not found"
        )
    
    await crm_crud.delete_client(client)