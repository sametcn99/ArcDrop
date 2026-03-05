using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ArcDrop.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCollectionHierarchyAndMembershipSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ParentId",
                schema: "public",
                table: "collections",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_collections_parent_id",
                schema: "public",
                table: "collections",
                column: "ParentId");

            migrationBuilder.AddForeignKey(
                name: "FK_collections_collections_ParentId",
                schema: "public",
                table: "collections",
                column: "ParentId",
                principalSchema: "public",
                principalTable: "collections",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_collections_collections_ParentId",
                schema: "public",
                table: "collections");

            migrationBuilder.DropIndex(
                name: "ix_collections_parent_id",
                schema: "public",
                table: "collections");

            migrationBuilder.DropColumn(
                name: "ParentId",
                schema: "public",
                table: "collections");
        }
    }
}
