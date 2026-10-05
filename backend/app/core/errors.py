from typing import Literal

ErrorKind = Literal['authentication', 'authorization', 'validation', 'not_found', 'conflict', 'database', 'provider', 'unavailable', 'internal']


class AppError(Exception):
    def __init__(self, code: str, kind: ErrorKind, message: str, status_code: int = 500):
        super().__init__(code)
        self.code = code
        self.kind = kind
        self.user_message = message
        self.status_code = status_code
