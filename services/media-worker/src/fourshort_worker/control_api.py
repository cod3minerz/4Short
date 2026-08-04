from __future__ import annotations

from dataclasses import dataclass
import httpx

from .config import Settings


class LeaseLostError(RuntimeError):
    """The job was cancelled, expired or reassigned while this worker ran."""


@dataclass(frozen=True)
class Job:
    id: str
    workspace_id: str
    project_id: str | None
    clip_id: str | None
    type: str
    job_class: str
    payload: dict
    attempt_count: int

    @classmethod
    def from_api(cls, value: dict) -> "Job":
        return cls(
            id=value["id"],
            workspace_id=value["workspaceId"],
            project_id=value.get("projectId"),
            clip_id=value.get("clipId"),
            type=value["type"],
            job_class=value["class"],
            payload=value["payload"],
            attempt_count=value["attemptCount"],
        )

class ControlApi:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = httpx.Client(
            base_url=settings.control_api_url,
            headers={"X-Worker-Token": settings.worker_api_token},
            timeout=httpx.Timeout(30, connect=10),
        )

    def register(self, capabilities: dict, metadata: dict) -> None:
        response = self.client.post("/v1/internal/workers/register", json={
            "workerId": self.settings.worker_id,
            "version": self.settings.worker_version,
            "capabilities": capabilities,
            "metadata": metadata,
        })
        response.raise_for_status()

    def claim(self, classes: list[str]) -> Job | None:
        response = self.client.post("/v1/internal/jobs/claim", json={
            "workerId": self.settings.worker_id,
            "classes": classes,
            "leaseSeconds": self.settings.lease_seconds,
        })
        if response.status_code == 204:
            return None
        response.raise_for_status()
        return Job.from_api(response.json())

    def heartbeat(self, job_id: str, checkpoint: str | None = None, progress: dict | None = None) -> None:
        response = self.client.post(f"/v1/internal/jobs/{job_id}/heartbeat", json={
            "workerId": self.settings.worker_id,
            "leaseSeconds": self.settings.lease_seconds,
            "checkpoint": checkpoint,
            "progress": progress,
        })
        if response.status_code == 409:
            raise LeaseLostError("Job lease is no longer owned by this worker")
        response.raise_for_status()

    def complete(self, job_id: str, result: dict, metrics: dict) -> None:
        response = self.client.post(f"/v1/internal/jobs/{job_id}/complete", json={
            "workerId": self.settings.worker_id,
            "result": result,
            "metrics": metrics,
        })
        response.raise_for_status()

    def fail(self, job_id: str, *, retryable: bool, code: str, message: str, details: dict) -> None:
        response = self.client.post(f"/v1/internal/jobs/{job_id}/fail", json={
            "workerId": self.settings.worker_id,
            "retryable": retryable,
            "code": code,
            "message": message,
            "details": details,
        })
        response.raise_for_status()
