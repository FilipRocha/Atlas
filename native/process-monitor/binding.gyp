{
  "targets": [
    {
      "target_name": "atlas_process_monitor",
      "sources": ["process_monitor.cc"],
      "defines": ["NAPI_VERSION=8", "UNICODE", "_UNICODE"],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": ["Psapi.lib", "Advapi32.lib"],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "AdditionalOptions": ["/std:c++17"]
              }
            }
          }
        ]
      ]
    }
  ]
}
