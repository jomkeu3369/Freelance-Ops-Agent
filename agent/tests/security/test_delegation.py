import pytest

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
