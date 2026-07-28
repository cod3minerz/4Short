from .errors import JobError


def validate_llm_model(model: str, allowed_models: set[str], blocked_prefixes: tuple[str, ...]) -> None:
    lowered = model.lower()
    if model not in allowed_models:
        raise JobError("LLM_MODEL_DENIED", f"Model {model} is not in the 4Short allowlist", retryable=False)
    if lowered == "openrouter/auto" or lowered.startswith(blocked_prefixes):
        raise JobError("LLM_MODEL_DENIED", f"Model {model} is prohibited by policy", retryable=False)
