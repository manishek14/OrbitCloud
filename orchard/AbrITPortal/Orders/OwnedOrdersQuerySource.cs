using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using OrchardCore.ContentManagement;
using OrchardCore.ContentManagement.Records;
using OrchardCore.Contents;
using OrchardCore.Queries;
using YesSql;

namespace AbrITPortal.Orders;

/// <summary>Runs MyOrders in the tenant session, independently of the public search index.</summary>
public sealed class OwnedOrdersQuerySource(
    IHttpContextAccessor httpContextAccessor,
    YesSql.ISession session,
    IAuthorizationService authorizationService) : IQuerySource
{
    public const string SourceName = "AbrITOrders";
    public string Name => SourceName;

    public async Task<IQueryResults> ExecuteQueryAsync(Query query, IDictionary<string, object> parameters)
    {
        var results = new OrderQueryResults();
        var user = httpContextAccessor.HttpContext?.User;
        var userId = user?.FindFirstValue(ClaimTypes.NameIdentifier);
        if (query.Name != "MyOrders" || user?.Identity?.IsAuthenticated != true || string.IsNullOrWhiteSpace(userId))
            return results;

        // Caller-supplied email, owner, userId, price and status are never used.
        var candidates = await session.Query<ContentItem, ContentItemIndex>(
            x => x.ContentType == "AbrITOrder" && x.Published && x.Owner == userId)
            .OrderByDescending(x => x.CreatedUtc).Take(100).ListAsync();

        var allowed = new List<object>();
        foreach (var order in candidates)
        {
            if ((await authorizationService.AuthorizeAsync(user!, order,
                new[] { new OrchardCore.Security.PermissionRequirement(CommonPermissions.ViewContent) })).Succeeded)
                allowed.Add(order);
        }
        results.Items = allowed;
        return results;
    }

    private sealed class OrderQueryResults : IQueryResults
    {
        public IEnumerable<object> Items { get; set; } = [];
    }
}
