# Architecture Checklist

- UI layers remain presentation-only.
- Domain has no infrastructure or UI dependency.
- Shared logic is in `packages/*`, not duplicated in app projects.
- API surface remains thin with validation and error translation.
- New dependencies are justified and documented.
