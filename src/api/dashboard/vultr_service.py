import os
import httpx
from typing import Dict, Any

from src.logs.log import get_logger

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
            account_data = account_resp.json().get("account", {})

            instances_resp = await client.get(f"{BASE_URL}/instances", headers=HEADERS)
            instances = instances_resp.json().get("instances", [])
            
            formatted_instances = []

            for server in instances:
                instance_id = server.get("id")
                bw_used = 0.0
                
                try:
                    bw_resp = await client.get(f"{BASE_URL}/instances/{instance_id}/bandwidth", headers=HEADERS)
                    if bw_resp.status_code == 200:
                        bw_data = bw_resp.json().get("bandwidth", {})
                        total_bytes = sum(int(d['incoming_bytes']) + int(d['outgoing_bytes']) for d in bw_data.get('bandwidth', {}).values())
                        bw_used = round(total_bytes / (1024**3), 2)

                except Exception:
                    bw_used = 0.0

                formatted_instances.append({
                    "id": instance_id,
                    "label": server.get("label", "No Label"),
                    "ip": server.get("main_ip"),
                    "status": server.get("status"),
                    "region": server.get("region"),
                    "vcpu_count": server.get("vcpu_count"),
                    "ram_mb": server.get("ram"),
                    "disk_gb": server.get("disk"),
                    "monthly_cost": float(server.get("monthly_cost", 0)),
                    "bandwidth_gb_used": bw_used
                })

            return {
                "balance": float(account_data.get("balance", 0)),
                "pending_charges": float(account_data.get("pending_charges", 0)),
                "instance_count": len(formatted_instances),
                "instances": formatted_instances
            }

        except httpx.HTTPError as e:
            logger.error(f"Vultr API Error: {str(e)}")
            raise e
        
        except Exception as e:
            logger.error(f"Dashboard Service Error: {str(e)}")
            raise e