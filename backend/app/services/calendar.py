import os
from datetime import datetime
from pathlib import Path
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from ..config import settings

SCOPES = ["https://www.googleapis.com/auth/calendar"]


def _get_credentials() -> Credentials | None:
    creds = None
    token_path = Path(settings.google_token_path)
    creds_path = Path(settings.google_credentials_path)

    if not creds_path.exists():
        return None

    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(creds_path), SCOPES)
            creds = flow.run_local_server(port=18428)
        token_path.write_text(creds.to_json())

    return creds


def get_calendar_service():
    creds = _get_credentials()
    if not creds:
        raise RuntimeError("Google Calendar not configured. Place credentials.json in ~/.todoai/")
    return build("calendar", "v3", credentials=creds)


def read_agenda(date_start: datetime, date_end: datetime, calendar_id: str = "primary") -> list[dict]:
    service = get_calendar_service()
    events_result = service.events().list(
        calendarId=calendar_id,
        timeMin=date_start.isoformat() + "Z",
        timeMax=date_end.isoformat() + "Z",
        singleEvents=True,
        orderBy="startTime",
    ).execute()
    return events_result.get("items", [])


def create_event(summary: str, start: datetime, end: datetime, calendar_id: str = "primary") -> dict:
    service = get_calendar_service()
    event = {
        "summary": summary,
        "start": {"dateTime": start.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": end.isoformat(), "timeZone": "UTC"},
    }
    return service.events().insert(calendarId=calendar_id, body=event).execute()


def update_event(event_id: str, start: datetime | None = None, end: datetime | None = None, summary: str | None = None, calendar_id: str = "primary") -> dict:
    service = get_calendar_service()
    event = service.events().get(calendarId=calendar_id, eventId=event_id).execute()
    if start:
        event["start"] = {"dateTime": start.isoformat(), "timeZone": "UTC"}
    if end:
        event["end"] = {"dateTime": end.isoformat(), "timeZone": "UTC"}
    if summary:
        event["summary"] = summary
    return service.events().update(calendarId=calendar_id, eventId=event_id, body=event).execute()
