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
