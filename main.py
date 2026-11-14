import os
from datetime import date, timedelta

from edupage_api import Edupage
from edupage_api.timeline import EventType

USER = os.environ["EDUPAGE_USER"]
PASS = os.environ["EDUPAGE_PASS"]
SCHOOL = os.environ["EDUPAGE_SCHOOL"]   # Subdomain, z.B. "meineschule" aus meineschule.edupage.org

edupage = Edupage()
edupage.login(USER, PASS, SCHOOL)

# --- Stundenplan (heute + morgen) ---
for d in (date.today(), date.today() + timedelta(days=1)):
    print(f"\n=== Stundenplan {d} ===")
    tt = edupage.get_my_timetable(d)
    if tt is None:
        print("kein Stundenplan verfügbar")
        continue
    for lesson in tt:
        fach = lesson.subject.name if lesson.subject else "?"
        print(f"{lesson.period}. {lesson.start_time}-{lesson.end_time}  {fach}")

# --- Hausaufgaben (kommen über die Timeline/Benachrichtigungen) ---
print("\n=== Hausaufgaben ===")
for n in edupage.get_notifications():
    if n.event_type == EventType.HOMEWORK:
        print(f"{n.timestamp:%d.%m.}  {n.text}")