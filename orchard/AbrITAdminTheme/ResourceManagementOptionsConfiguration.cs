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
            .SetVersion("3.1.0")
            .SetDependencies("the-admin");
        Manifest
            .DefineStyle("abrit-admin-polish")
            .SetUrl("~/AbrITPortal/css/admin-abrit.css")
            .SetVersion("1.0.0")
            .SetDependencies("abrit-admin");
    }

    public void Configure(ResourceManagementOptions options)
    {
        options.ResourceManifests.Add(Manifest);
    }
}
