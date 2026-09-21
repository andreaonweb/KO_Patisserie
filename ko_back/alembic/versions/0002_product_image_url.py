from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("product", sa.Column("image_url", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("product", "image_url")
