import os
import httpx
from typing import Dict, Any
from dotenv import load_dotenv

from src.logs.log import get_logger

load_dotenv()
logger = get_logger()

VULTR_API_KEY = os.getenv("VULTR_API_KEY")
BASE_URL = "https://api.vultr.com/v2"

HEADERS = {
    "Authorization": f"Bearer {VULTR_API_KEY}",
    "Content-Type": "application/json",
}

async def get_vultr_data() -> Dict[str, Any]:
    """
    Vultr API에서 계정 상태와 인스턴스 정보를 비동기로 조회하여 병합합니다.
    """
    if not VULTR_API_KEY:
        logger.warning("Vultr API Key가 설정되지 않았습니다.")
        return None

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            account_resp = await client.get(f"{BASE_URL}/account", headers=HEADERS)
            if account_resp.status_code != 200:
                logger.error(f"Vultr Account API Error: {account_resp.status_code} - {account_resp.text}")
                account_resp.raise_for_status()
            
            account_data = account_resp.json().get("account", {})

            instances_resp = await client.get(f"{BASE_URL}/instances", headers=HEADERS)
            if instances_resp.status_code != 200:
                logger.error(f"Vultr Instances API Error: {instances_resp.status_code} - {instances_resp.text}")
                instances_resp.raise_for_status()

            instances = instances_resp.json().get("instances", [])
            formatted_instances = []

            for server in instances:
                instance_id = server.get("id")
                bw_used = 0.0
                
                try:
                    bw_resp = await client.get(f"{BASE_URL}/instances/{instance_id}/bandwidth", headers=HEADERS)
                    
                    if bw_resp.status_code == 200:
                        bw_dict = bw_resp.json().get("bandwidth", {})
                        
                        total_bytes = sum(
                            int(d.get('incoming_bytes', 0)) + int(d.get('outgoing_bytes', 0)) 
                            for d in bw_dict.values()
                        )
                        bw_used = round(total_bytes / (1024**3), 2)
                    else:
                        logger.warning(f"Bandwidth lookup failed for {instance_id}: {bw_resp.status_code}")

                except Exception as e:
                    logger.warning(f"Bandwidth calc error for {instance_id}: {e}")
                    bw_used = 0.0

                formatted_instances.append({
                    "id": instance_id,
                    "label": server.get("label", "No Label"),
                    "ip": server.get("main_ip"),
                    "status": server.get("status"),
                    "region": server.get("region"),
                    "vcpu_count": int(server.get("vcpu_count", 0)),
                    "ram_mb": int(server.get("ram", 0)),
                    "disk_gb": int(server.get("disk", 0)),
                    "monthly_cost": float(server.get("monthly_cost", 0)),
                    "bandwidth_gb_used": bw_used
                })

            return {
                "balance": float(account_data.get("balance", 0)),
                "pending_charges": float(account_data.get("pending_charges", 0)),
                "instance_count": len(formatted_instances),
                "instances": formatted_instances
            }

        except httpx.HTTPStatusError as e:
            logger.error(f"Vultr API HTTP Error: {e.response.status_code} - {e.response.text}")
            raise e
        
        except Exception as e:
            logger.error(f"Dashboard Service Unexpected Error: {str(e)}")
            raise e