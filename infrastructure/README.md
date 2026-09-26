# Infrastructure

| Directory         | Purpose                                                                                                                                 | Status                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `docker/`         | Optional Docker Compose for local PostgreSQL + Redis                                                                                    | Phase 1 — available                 |
| `aws/`            | AWS resource notes/config (S3, CloudFront, RDS, ElastiCache, Secrets Manager, CloudWatch)                                               | Empty — production deployment phase |
| `terraform/`      | Infrastructure-as-code for AWS                                                                                                          | Empty — production deployment phase |
| `github-actions/` | Reserved. The active CI quality gate lives in `.github/workflows/ci.yml` (GitHub requires that path). Deployment workflows: CI/CD phase | Empty                               |

No cloud resources are provisioned in Phase 1. Nothing here should be populated
speculatively; add resources only when the owning phase is approved.
