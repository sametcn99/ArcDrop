using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ArcDrop.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAiProviderConfig : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ai_provider_configs",
                schema: "public",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ApiEndpoint = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    Model = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ApiKeyCipherText = table.Column<string>(type: "character varying(4096)", maxLength: 4096, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_provider_configs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_ai_provider_configs_updated_at_utc",
                schema: "public",
                table: "ai_provider_configs",
                column: "UpdatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "ux_ai_provider_configs_provider_name",
                schema: "public",
                table: "ai_provider_configs",
                column: "ProviderName",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ai_provider_configs",
                schema: "public");
        }
    }
}
