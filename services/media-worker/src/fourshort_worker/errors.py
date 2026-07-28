class JobError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.details = details or {}
