"""Fire-safety words the name model mistakes for people, e.g. "Hosereel" (PV-01).

A name the model guessed is kept as text when every one of its words is here. Known names and
patterns are never checked against it. Lower case; add a word when a test or a draft shows the
model taking it for a person.
"""

ALLOWED = frozenset(
    # Site-note abbreviations (rag-service/app/retrieval/site_abbreviations.json).
    """
    spk spks srv rm rms pens cv cyl cyls fa fcc bsmt bsmts svc elec rc flr flrs thru
    """.split()
    # Equipment and systems.
    + """
    hosereel hosereels hose reel reels sprinkler sprinklers riser risers jockey pump pumps
    deluge drencher hydrant hydrants extinguisher extinguishers alarm alarms detector detectors
    damper dampers valve valves cylinder cylinders genset generator transformer switchboard
    """.split()
    # Brands, agents and standard bodies.
    + """
    tyco viking reliable kidde ansul victaulic siemens honeywell notifier hochiki apollo
    inergen novec fm-200 argonite fm nfpa scdf ul vds
    """.split()
)


def is_allowed(text: str) -> bool:
    words = text.casefold().split()
    return bool(words) and all(word in ALLOWED for word in words)


# Organisations and bodies that are never a client (CP-23). Whole names, lower case. Without this,
# detecting organisations would mask Marsh and the standards bodies the drafts need.
NEVER_MASK = frozenset(
    ["marsh", "marsh mclennan", "fm global", "fm", "nfpa", "scdf", "ul", "vds", "lpcb"]
    + ["singapore civil defence force", "munich re", "swiss re"]
)


# Names whose teams are never masked either ("Marsh Property Risk Engineering"). Short names
# such as "FM" are left out: "FM Logistics" could be a client.
TEAMS_OF = ("marsh", "fm global")


def is_never_masked(text: str) -> bool:
    """Whether `text` is a listed name, or a team of Marsh or FM Global."""
    name = " ".join(text.casefold().split())
    return name in NEVER_MASK or any(name.startswith(team + " ") for team in TEAMS_OF)
