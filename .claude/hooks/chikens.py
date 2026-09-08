#!/usr/bin/env python3
"""Chikens — porte d'entree sur chaque prompt.

Prompt normal : Claude analyse l'intention et note le risque back-end, sans rien executer.
"go"          : la demande en attente est debloquee et executee.
"""
import hashlib
import json
import os
import re
import sys
import tempfile

SKIP_SLASH = True  # laisse passer les commandes /slash sans controle

REVIEW = """[CHIKENS — controle d'intention actif]
N'EXECUTE PAS la demande de l'utilisateur. Interdits pour ce tour : Edit, Write, commit, migration, \
toute commande qui ecrit. Lecture seule autorisee (rapide) pour juger l'impact.

Reponds en francais, sous ce format exact :

🐔 Chikens — Risque back-end : NN/100 (LIBELLE)
**Ce que je comprends** — 1 a 2 phrases sur l'intention reelle.
**Impact back-end** — puces : tables / RLS / RPC / cron / secrets / contrats client touches (ou « aucun »).
**Ce qui m'inquiete** — puces (ou « rien de bloquant »).
**Ma reco** — ce que tu ferais, ou l'alternative plus sure.

Termine par exactement cette ligne : Tape `go` pour lancer.

Bareme : .claude/chikens/rubric.md — lis-le si tu hesites sur la note. Reste bref (15 lignes max), \
ton de collegue, pas de sermon.
Exception : si la demande est purement conversationnelle (une question, aucune action a faire), \
ecris juste « 🐔 0/100 — lecture seule » puis reponds normalement a la question."""

GO = """[CHIKENS — GO recu]
L'utilisateur valide. Execute MAINTENANT la demande en attente, sans redemander confirmation et \
sans refaire l'analyse de risque :
--- demande validee ---
{pending}
--- fin ---
Applique les precautions que tu as annoncees dans ton analyse Chikens."""


def emit(context):
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": context,
            },
            "suppressOutput": True,
        },
        sys.stdout,
    )
    sys.exit(0)


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        print('{"continue":true}')
        return

    prompt = data.get("prompt") or ""
    session = re.sub(r"[^A-Za-z0-9_-]", "_", data.get("session_id") or "default")[:64]
    if not session:
        session = hashlib.sha1(b"chikens").hexdigest()[:12]
    state = os.path.join(tempfile.gettempdir(), "chikens-%s.pending" % session)

    trimmed = prompt.strip()
    if not trimmed or (SKIP_SLASH and trimmed.startswith("/")):
        print('{"continue":true}')
        return

    if trimmed.lower() == "go":
        pending = ""
        try:
            with open(state, encoding="utf-8") as fh:
                pending = fh.read().strip()
            os.remove(state)
        except OSError:
            pass
        if not pending:
            emit("[CHIKENS] Rien en attente. Reprends normalement la conversation.")
        emit(GO.format(pending=pending))

    try:
        with open(state, "w", encoding="utf-8") as fh:
            fh.write(prompt)
    except OSError:
        pass
    emit(REVIEW)


if __name__ == "__main__":
    main()
