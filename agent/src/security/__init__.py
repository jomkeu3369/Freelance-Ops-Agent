"""Internal service authentication."""

from .delegation import DelegationPrincipal, DelegationTokenVerifier, TokenVerificationError

__all__ = ["DelegationPrincipal", "DelegationTokenVerifier", "TokenVerificationError"]
