"""Domain errors with stable machine-readable codes."""

from __future__ import annotations


class HaieRagError(Exception):
    code = "INTERNAL_ERROR"
    status_code = 500
    transient = False

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class ModelUnavailableError(HaieRagError):
    """A local model is not installed / not loadable. Never fall back to a remote provider."""

    code = "MODEL_UNAVAILABLE"
    status_code = 503


class InferenceBackendError(HaieRagError):
    """The inference runtime (Ollama) is unreachable or returned an error. Usually transient."""

    code = "AI_UNAVAILABLE"
    status_code = 503
    transient = True


class EmbeddingValidationError(HaieRagError):
    code = "EMBEDDING_INVALID"
    status_code = 502


class DocumentParseError(HaieRagError):
    """The document could not be parsed. Permanent: retrying will not help."""

    code = "PARSE_FAILED"
    status_code = 422


class UnsupportedDocumentError(DocumentParseError):
    code = "UNSUPPORTED_DOCUMENT"


class UrlImportError(HaieRagError):
    """A link could not be imported (blocked, unreachable, unsupported or too large). Shown to the user."""

    code = "URL_FETCH_FAILED"
    status_code = 422

    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        if code:
            self.code = code
