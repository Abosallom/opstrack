# import-runs — what each `--apply` of import-structure actually wrote

Each file here records **one run**: the id and full path of every node it
created, every use-case link it set or cleared with the status that was there
before it, every field it overwrote with its old value, the project ref and the
clock. No credentials, no emails, no usernames.

To reverse exactly one of those runs:

```sh
node scripts/import-structure.mjs --undo docs/EVIDENCE/import-runs/<the newest file>
```

That is a **dry run** — it prints what it would remove and stops. Add `--apply`
to perform it. It can touch nothing that is not in that file, and it refuses by
name any node that has since gained a child it did not create, entries, a
capability status somebody set by hand, or a deliberate move. See
[`docs/templates/README.md`](../../templates/README.md#taking-an-import-back).

**THESE ARE COMMITTED.** There is no column in the database that says a row came
from an import — `map_nodes.source` is constrained to `('local','jira')` and
there is no third value — so the manifest is the *only* thing that knows which
rows a run created. An undo that exists on one laptop is not an undo: it has to
survive a `git clean`, a fresh clone, and the machine the import was run from.

**Do not hand-edit them.** A manifest that is silently short leaves rows behind
that nothing will ever be able to name again, and the reader deliberately
refuses a file whose records it cannot execute rather than guessing — guessing
here means deleting the wrong uuid.

The directory is created by `--apply` if it is not already there; this file is
what stops the first manifest to land from being a mystery JSON in the evidence
folder.
