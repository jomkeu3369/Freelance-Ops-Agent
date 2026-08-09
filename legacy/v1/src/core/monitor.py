import psutil
from src.api.dashboard.dashboard_schema import ServerResources

def get_server_resources() -> ServerResources:
    """
    현재 서버(컨테이너)의 CPU, RAM, Disk 사용량을 측정합니다.
    """
    
    cpu_percent = psutil.cpu_percent(interval=None)

    mem = psutil.virtual_memory()
    mem_total_gb = round(mem.total / (1024**3), 2)
    mem_used_gb = round(mem.used / (1024**3), 2)

    disk = psutil.disk_usage('/')
    disk_total_gb = round(disk.total / (1024**3), 2)
    disk_used_gb = round(disk.used / (1024**3), 2)

    return ServerResources(
        cpu_usage_percent=cpu_percent,
        memory_usage_percent=mem.percent,
        memory_total_gb=mem_total_gb,
        memory_used_gb=mem_used_gb,
        disk_usage_percent=disk.percent,
        disk_total_gb=disk_total_gb,
        disk_used_gb=disk_used_gb
    )