from typing import List, Optional
from pydantic import BaseModel

class ServerResources(BaseModel):
    cpu_usage_percent: float
    memory_usage_percent: float
    memory_total_gb: float
    memory_used_gb: float
    disk_usage_percent: float
    disk_total_gb: float
    disk_used_gb: float

class VultrInstance(BaseModel):
    id: str
    label: str
    ip: str
    status: str
    region: str
    vcpu_count: int
    ram_mb: int
    disk_gb: int
    monthly_cost: float
    bandwidth_gb_used: float


class DashboardData(BaseModel):
    balance: float                  # 현재 예치금
    pending_charges: float          # 이번 달 청구 예정 금액
    instance_count: int             # 서버 개수
    server_resources: ServerResources 
    instances: List[VultrInstance]