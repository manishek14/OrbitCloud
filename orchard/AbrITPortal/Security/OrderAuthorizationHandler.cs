using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using OrchardCore.ContentManagement;
using OrchardCore.Contents;
using OrchardCore.Security;

namespace AbrITPortal.Security;

/// <summary>A veto is required because generic ViewContent may already have succeeded.</summary>
public sealed class OrderAuthorizationHandler : AuthorizationHandler<PermissionRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        var order = context.Resource as ContentItem;
        if (order?.ContentType != "AbrITOrder" && context.Resource as string != "AbrITOrder")
            return Task.CompletedTask;

        if (context.User.Identity?.IsAuthenticated != true)
        {
            context.Fail();
            return Task.CompletedTask;
        }

        if (context.User.IsInRole("Administrator"))
        {
            context.Succeed(requirement);
            return Task.CompletedTask;
        }

        var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        var isRead = requirement.Permission.Name == CommonPermissions.ViewContent.Name
            || requirement.Permission.Name == CommonPermissions.ViewOwnContent.Name;

        // Native Owner is Orchard's stable UserId. Never infer it from email or author.
        if (isRead && order is { Published: true } && !string.IsNullOrWhiteSpace(userId)
            && string.Equals(order.Owner, userId, StringComparison.Ordinal))
            context.Succeed(requirement);
        else
            context.Fail();

        return Task.CompletedTask;
    }
}
