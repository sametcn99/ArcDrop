using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ArcDrop.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAiOperationAuditLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ai_operations_log",
                schema: "public",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    OperationType = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    BookmarkUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    BookmarkTitle = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    BookmarkSummary = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    OutcomeStatus = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    FailureReason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    StartedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_operations_log", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ai_operation_results",
                schema: "public",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OperationId = table.Column<Guid>(type: "uuid", nullable: false),
                    ResultType = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Value = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    Confidence = table.Column<decimal>(type: "numeric(4,3)", precision: 4, scale: 3, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_operation_results", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ai_operation_results_ai_operations_log_OperationId",
                        column: x => x.OperationId,
                        principalSchema: "public",
                        principalTable: "ai_operations_log",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_ai_operation_results_operation_id",
                schema: "public",
                table: "ai_operation_results",
                column: "OperationId");

            migrationBuilder.CreateIndex(
                name: "ix_ai_operation_results_result_type",
                schema: "public",
                table: "ai_operation_results",
                column: "ResultType");

            migrationBuilder.CreateIndex(
                name: "ix_ai_operations_log_operation_type",
                schema: "public",
                table: "ai_operations_log",
                column: "OperationType");

            migrationBuilder.CreateIndex(
                name: "ix_ai_operations_log_outcome_status",
                schema: "public",
                table: "ai_operations_log",
                column: "OutcomeStatus");

            migrationBuilder.CreateIndex(
                name: "ix_ai_operations_log_provider_name",
                schema: "public",
                table: "ai_operations_log",
                column: "ProviderName");

            migrationBuilder.CreateIndex(
                name: "ix_ai_operations_log_started_at_utc",
                schema: "public",
                table: "ai_operations_log",
                column: "StartedAtUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ai_operation_results",
                schema: "public");

            migrationBuilder.DropTable(
                name: "ai_operations_log",
                schema: "public");
        }
    }
}
