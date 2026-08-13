from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from security import DelegationTokenVerifier


@pytest.mark.parametrize("algorithm", ["HS256", "hs256", "none", "RS999"])
def test_rejects_symmetric_or_unknown_delegation_algorithms(algorithm: str) -> None:
    with pytest.raises(ValueError, match="asymmetric"):
        DelegationTokenVerifier(
            public_key="key",
            issuer="issuer",
            audience="audience",
            algorithms=(algorithm,),
        )


def test_accepts_active_and_previous_rotation_keys_but_rejects_unknown_kid() -> None:
    active_private, active_public = _key_pair()
    previous_private, previous_public = _key_pair()
    unknown_private, _ = _key_pair()
    verifier = DelegationTokenVerifier(
        public_key=active_public,
        key_id="active-v2",
        previous_public_keys={"previous-v1": previous_public},
        issuer="issuer",
        audience="agent"
    )

    assert verifier.verify(_token(active_private, "active-v2")).permissions == frozenset({"agent.run"})
    assert verifier.verify(_token(previous_private, "previous-v1")).permissions == frozenset({"agent.run"})
    with pytest.raises(ValueError, match="invalid"):
        verifier.verify(_token(unknown_private, "unknown"))


def _key_pair() -> tuple[rsa.RSAPrivateKey, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return private_key, public_key


def _token(private_key: rsa.RSAPrivateKey, key_id: str) -> str:
    now = datetime.now(UTC)
    user_id = uuid4()
    return jwt.encode(
        {
            "iss": "issuer",
            "aud": "agent",
            "sub": str(user_id),
            "jti": str(uuid4()),
            "iat": now,
            "exp": now + timedelta(minutes=1),
            "run_id": str(uuid4()),
            "workspace_id": str(uuid4()),
            "project_id": str(uuid4()),
            "initiated_by": str(user_id),
            "permissions": ["agent.run"]
        },
        private_key,
        algorithm="RS256",
        headers={"kid": key_id}
    )
