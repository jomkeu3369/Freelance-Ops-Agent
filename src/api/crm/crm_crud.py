from typing import List, Optional

from src.api.schemas.client import Client
from src.api.crm.crm_schema import ClientCreate

async def get_all_clients() -> List[Client]:
    return await Client.find_all().sort("-created_at").to_list()

async def get_client_by_id(client_id: str) -> Optional[Client]:
    return await Client.get(client_id)

async def update_client(client: Client, client_data: ClientCreate) -> Client:
    client.name = client_data.name
    client.status = client_data.status
    await client.save()
    return client


async def create_client(client_data: ClientCreate) -> Client:
    client = Client(**client_data.dict())
    await client.insert()
    return client

async def delete_client(client: Client) -> None:
    await client.delete()