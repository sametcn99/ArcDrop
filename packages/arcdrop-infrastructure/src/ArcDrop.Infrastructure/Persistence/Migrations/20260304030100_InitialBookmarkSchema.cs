using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ArcDrop.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialBookmarkSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Establish the PostgreSQL public schema explicitly so table placement remains deterministic
            // across local, CI, and self-hosted runtime environments.
            migrationBuilder.EnsureSchema(
                name: "public");

            migrationBuilder.CreateTable(
                name: "bookmarks",
                schema: "public",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Url = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    Title = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    Summary = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_bookmarks", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "collections",
                schema: "public",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_collections", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "tags",
                schema: "public",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    NameNormalized = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tags", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "bookmark_collection_links",
                schema: "public",
                columns: table => new
                {
                    BookmarkId = table.Column<Guid>(type: "uuid", nullable: false),
                    CollectionId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_bookmark_collection_links", x => new { x.BookmarkId, x.CollectionId });
                    table.ForeignKey(
                        name: "FK_bookmark_collection_links_bookmarks_BookmarkId",
                        column: x => x.BookmarkId,
                        principalSchema: "public",
                        principalTable: "bookmarks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_bookmark_collection_links_collections_CollectionId",
                        column: x => x.CollectionId,
                        principalSchema: "public",
                        principalTable: "collections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "bookmark_tags",
                schema: "public",
                columns: table => new
                {
                    BookmarkId = table.Column<Guid>(type: "uuid", nullable: false),
                    TagId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_bookmark_tags", x => new { x.BookmarkId, x.TagId });
                    table.ForeignKey(
                        name: "FK_bookmark_tags_bookmarks_BookmarkId",
                        column: x => x.BookmarkId,
                        principalSchema: "public",
                        principalTable: "bookmarks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_bookmark_tags_tags_TagId",
                        column: x => x.TagId,
                        principalSchema: "public",
                        principalTable: "tags",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_bookmark_collection_links_collection_id",
                schema: "public",
                table: "bookmark_collection_links",
                column: "CollectionId");

            migrationBuilder.CreateIndex(
                name: "ix_bookmark_tags_tag_id",
                schema: "public",
                table: "bookmark_tags",
                column: "TagId");

            migrationBuilder.CreateIndex(
                name: "ix_bookmarks_created_at_utc",
                schema: "public",
                table: "bookmarks",
                column: "CreatedAtUtc");

            migrationBuilder.CreateIndex(
                name: "ix_bookmarks_title",
                schema: "public",
                table: "bookmarks",
                column: "Title");

            migrationBuilder.CreateIndex(
                name: "ix_bookmarks_url",
                schema: "public",
                table: "bookmarks",
                column: "Url");

            migrationBuilder.CreateIndex(
                name: "ux_collections_name",
                schema: "public",
                table: "collections",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_tags_name_normalized",
                schema: "public",
                table: "tags",
                column: "NameNormalized",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Drop relation tables first to satisfy foreign key constraints during rollback.
            // This order guarantees migration reversibility without manual clean-up steps.
            migrationBuilder.DropTable(
                name: "bookmark_collection_links",
                schema: "public");

            migrationBuilder.DropTable(
                name: "bookmark_tags",
                schema: "public");

            migrationBuilder.DropTable(
                name: "collections",
                schema: "public");

            migrationBuilder.DropTable(
                name: "bookmarks",
                schema: "public");

            migrationBuilder.DropTable(
                name: "tags",
                schema: "public");
        }
    }
}
