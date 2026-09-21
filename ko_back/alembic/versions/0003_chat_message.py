from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_message",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("sender_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("read_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_chat_message_customer_id_id", "chat_message", ["customer_id", "id"])


def downgrade() -> None:
    op.drop_index("ix_chat_message_customer_id_id", table_name="chat_message")
    op.drop_table("chat_message")
