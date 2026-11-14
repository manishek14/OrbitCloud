using Microsoft.Extensions.Options;
using OrchardCore.ResourceManagement;

namespace AbrITAdminTheme;

public sealed class ResourceManagementOptionsConfiguration : IConfigureOptions<ResourceManagementOptions>
{
    private static readonly ResourceManifest Manifest;

    static ResourceManagementOptionsConfiguration()
    {
        Manifest = new ResourceManifest();
        Manifest
            .DefineStyle("abrit-admin")
            .SetUrl("~/AbrITAdminTheme/css/abrit-admin.css")
            .SetVersion("3.0.0")
            .SetDependencies("the-admin");
    }

    public void Configure(ResourceManagementOptions options)
    {
        options.ResourceManifests.Add(Manifest);
    }
}
