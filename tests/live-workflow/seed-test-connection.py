"""The exact synthetic, never-decrypted BYOK row from ConnectedWorkflowPostgresTest."""

import os
import sys
from uuid import UUID, uuid4

import psycopg

user, workspace = (UUID(value) for value in sys.argv[1:3])
connection = uuid4()
connection_info = psycopg.conninfo.conninfo_to_dict(
    os.environ.get(
        "LIVE_DB_DSN", "host=127.0.0.1 port=18222 dbname=freelance_ops user=app_user"
    )
)
if (
    connection_info.get("host") != "127.0.0.1"
    or not 18200 <= int(connection_info.get("port", "0")) <= 18249
):
    raise RuntimeError("Synthetic fixture requires the isolated loopback test database")
with psycopg.connect(
    os.environ.get(
        "LIVE_DB_DSN", "host=127.0.0.1 port=18222 dbname=freelance_ops user=app_user"
    )
) as database:
    if (
        database.execute(
            "select count(*) from app.user_account where id=%s and email like %s",
            (user, "%@example.invalid"),
        ).fetchone()[0]
        != 1
    ):
        raise RuntimeError("Synthetic fixture requires a synthetic registered account")
    database.execute(
        "insert into app.ai_connection(id,workspace_id,user_id,provider,model,ciphertext,masked_key) values (?,?,?,'OPENAI','gpt-6-luna','synthetic-never-decrypted','test')".replace(
            "?", "%s"
        ),
        (connection, workspace, user),
    )
print(connection)
