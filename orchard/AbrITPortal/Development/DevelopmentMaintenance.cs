using System.Security.Claims;
using System.Text.Json.Nodes;
using Npgsql;
using OrchardCore.ContentManagement;
using OrchardCore.ContentManagement.Records;
using OrchardCore.Entities;
using OrchardCore.Environment.Shell;
using OrchardCore.Indexing;
using OrchardCore.Indexing.Core;
using OrchardCore.Indexing.Models;
using OrchardCore.Lucene.Models;
using OrchardCore.Queries;
using AbrITPortal.Orders;
using YesSql;

namespace AbrITPortal.Development;

public static class DevelopmentMaintenance
{
    public static async Task ApplyAsync(IServiceProvider services)
    {
        var settings = services.GetRequiredService<ShellSettings>();
        var database = new NpgsqlConnectionStringBuilder(settings["ConnectionString"]).Database;
        if (database?.StartsWith("abrit_portal_dev_", StringComparison.Ordinal) != true)
            throw new InvalidOperationException("Maintenance refused a non-development database.");

        var queries = services.GetRequiredService<IQueryManager>();
        var myOrders = await queries.GetQueryAsync("MyOrders")
            ?? throw new InvalidOperationException("Existing MyOrders query is missing.");
        if (myOrders.Source != OwnedOrdersQuerySource.SourceName)
        {
            myOrders.Source = OwnedOrdersQuerySource.SourceName;
            myOrders.Properties = new JsonObject();
            await queries.SaveAsync(myOrders);
        }

        var allServices = await queries.GetQueryAsync("AllServices")
            ?? throw new InvalidOperationException("Existing AllServices query is missing.");
        var metadata = allServices.GetOrCreate<LuceneQueryMetadata>();
        const string template = """{"query":{"term":{"Content.ContentItem.ContentType":"AbrITService"}},"size":100}""";
        if (metadata.Index != "search" || metadata.Template != template)
        {
            metadata.Index = "search";
            metadata.Template = template;
            allServices.Put(metadata);
            await queries.SaveAsync(allServices);
        }

        var profiles = services.GetRequiredService<IIndexProfileManager>();
        var search = await profiles.FindByNameAsync("search")
            ?? throw new InvalidOperationException("Existing search index profile is missing.");
        if (search.ProviderName != "Lucene" || search.Type != "Content")
            throw new InvalidOperationException("Search profile has unexpected provider or type.");
        if (search.IndexName != search.IndexName.Trim() || search.IndexFullName != search.IndexFullName.Trim())
        {
            search.IndexName = search.IndexName.Trim();
            search.IndexFullName = search.IndexFullName.Trim();
            await profiles.UpdateAsync(search);
            await profiles.ResetAsync(search);
        }

        // Rebuild only the cloned Lucene files, then enqueue the published services.
        var indexManager = services.GetRequiredKeyedService<IIndexManager>("Lucene");
        await profiles.ResetAsync(search);
        if (!await indexManager.RebuildAsync(search))
            throw new InvalidOperationException("Development search index rebuild failed.");
        var session = services.GetRequiredService<YesSql.ISession>();
        var catalogItems = await session.Query<ContentItem, ContentItemIndex>(
            x => x.ContentType == "AbrITService" && x.Published).ListAsync();
        var tasks = services.GetRequiredService<IIndexingTaskManager>();
        foreach (var item in catalogItems)
            await tasks.CreateTaskAsync(new CreateIndexingTaskContext(
                item.ContentItemId, "Content", RecordIndexingTaskTypes.Update));
    }

    public static async Task ProcessIndexAsync(IServiceProvider services)
    {
        var settings = services.GetRequiredService<ShellSettings>();
        if (new NpgsqlConnectionStringBuilder(settings["ConnectionString"]).Database
            ?.StartsWith("abrit_portal_dev_", StringComparison.Ordinal) != true)
            throw new InvalidOperationException("Index processing refused a non-development database.");
        var profile = await services.GetRequiredService<IIndexProfileManager>().FindByNameAsync("search")
            ?? throw new InvalidOperationException("Search profile missing.");
        await services.GetRequiredService<ContentIndexingService>().ProcessRecordsAsync([profile.Id]);
    }

    public static async Task VerifyAsync(IServiceProvider services)
    {
        var settings = services.GetRequiredService<ShellSettings>();
        if (new NpgsqlConnectionStringBuilder(settings["ConnectionString"]).Database
            ?.StartsWith("abrit_portal_dev_", StringComparison.Ordinal) != true)
            throw new InvalidOperationException("Verification refused a non-development database.");

        var queries = services.GetRequiredService<IQueryManager>();
        var allServices = await queries.GetQueryAsync("AllServices")
            ?? throw new InvalidOperationException("AllServices missing");
        var accessor = services.GetRequiredService<IHttpContextAccessor>();
        var previous = accessor.HttpContext;
        accessor.HttpContext = new DefaultHttpContext { RequestServices = services };
        var servicesResult = await queries.ExecuteQueryAsync(allServices, new Dictionary<string, object>());
        Console.WriteLine("Catalog query returned " + servicesResult.Items.Count() + " service(s).");

        var session = services.GetRequiredService<YesSql.ISession>();
        var order = await session.Query<ContentItem, ContentItemIndex>(
            x => x.ContentType == "AbrITOrder" && x.Published).FirstOrDefaultAsync();
        if (order is null || string.IsNullOrWhiteSpace(order.Owner))
        {
            Console.WriteLine("Existing order has no stable owner; legacy ownership was not inferred.");
            accessor.HttpContext = previous;
            return;
        }

        try
        {
            var myOrders = await queries.GetQueryAsync("MyOrders")
                ?? throw new InvalidOperationException("MyOrders missing");
            var anonymousCount = (await queries.ExecuteQueryAsync(myOrders,
                new Dictionary<string, object>())).Items.Count();
            accessor.HttpContext.User = Principal(order.Owner);
            var ownerCount = (await queries.ExecuteQueryAsync(myOrders,
                new Dictionary<string, object> { ["owner"] = "not-the-real-owner" })).Items.Count();
            accessor.HttpContext.User = Principal("unrelated-fixture-user-id");
            var otherCount = (await queries.ExecuteQueryAsync(myOrders,
                new Dictionary<string, object> { ["owner"] = order.Owner })).Items.Count();
            Console.WriteLine("Order query counts: anonymous=" + anonymousCount
                + ", owner=" + ownerCount + ", unrelated=" + otherCount + ".");
            if (anonymousCount != 0 || ownerCount < 1 || otherCount != 0)
                throw new InvalidOperationException("Order query isolation verification failed.");
        }
        finally
        {
            accessor.HttpContext = previous;
        }
    }

    private static ClaimsPrincipal Principal(string id) =>
        new(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, id)], "DevelopmentFixture"));
}

