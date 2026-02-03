from typing import List, Optional
from pydantic import BaseModel

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
    instances: List[VultrInstance]