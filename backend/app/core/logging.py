import json
import logging
import sys
from datetime import datetime, timezone

SAFE_FIELDS = frozenset({'request_id', 'method', 'status', 'elapsed_ms', 'event', 'error_code', 'exception_type', 'job_id', 'job_type'})


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {'timestamp': datetime.now(timezone.utc).isoformat(), 'level': record.levelname, 'logger': record.name}
        fields = getattr(record, 'context', {})
        payload.update({key: value for key, value in fields.items() if key in SAFE_FIELDS})
        # Never serialize arbitrary exception reprs or raw messages (may contain tokens/SQL).
        payload['event'] = fields.get('event', 'server_log')
        return json.dumps(payload, default=str)


def setup_logging(level: str = 'INFO') -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger('tonde')
    logger.setLevel(level.upper())
    logger.handlers = [handler]
    logger.propagate = False
    # HTTP client request URLs may include signed links. Disable verbose transport logs.
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('httpcore').setLevel(logging.WARNING)
