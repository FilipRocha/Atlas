#include <node_api.h>
#include <windows.h>
#include <tlhelp32.h>
#include <psapi.h>
#include <sddl.h>

#include <algorithm>
#include <cstdint>
#include <cwchar>
#include <mutex>
#include <new>
#include <string>
#include <unordered_map>
#include <vector>

#pragma comment(lib, "Psapi.lib")
#pragma comment(lib, "Advapi32.lib")

struct ProcessRow {
  DWORD pid = 0;
  DWORD parentPid = 0;
  double cpuPercent = 0.0;
  uint64_t memBytes = 0;
  std::wstring name;
  std::wstring path;
  std::wstring user;
  std::wstring started;
};

struct ProcessTimes {
  ULONGLONG created = 0;
  ULONGLONG kernel = 0;
  ULONGLONG user = 0;
};

struct ProcessMetadata {
  ULONGLONG created = 0;
  std::wstring path;
  std::wstring user;
  std::wstring started;
};

struct AsyncContext {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  std::vector<ProcessRow> rows;
  std::string error;
};

static std::mutex g_stateMutex;
static ULONGLONG g_lastSystemTime = 0;
static std::unordered_map<DWORD, ProcessTimes> g_lastProcessTimes;
static std::unordered_map<DWORD, ProcessMetadata> g_processMetadata;

static ULONGLONG FileTimeValue(const FILETIME& value) {
  ULARGE_INTEGER result;
  result.LowPart = value.dwLowDateTime;
  result.HighPart = value.dwHighDateTime;
  return result.QuadPart;
}

static std::string Utf8(const std::wstring& value) {
  if (value.empty()) return std::string();
  const int required = WideCharToMultiByte(
      CP_UTF8, WC_ERR_INVALID_CHARS, value.c_str(), static_cast<int>(value.size()),
      nullptr, 0, nullptr, nullptr);
  if (required <= 0) return std::string();
  std::string result(static_cast<size_t>(required), '\0');
  const int written = WideCharToMultiByte(
      CP_UTF8, WC_ERR_INVALID_CHARS, value.c_str(), static_cast<int>(value.size()),
      &result[0], required, nullptr, nullptr);
  if (written != required) return std::string();
  return result;
}

static std::wstring ProcessPath(HANDLE process) {
  std::vector<wchar_t> buffer(32768);
  DWORD length = static_cast<DWORD>(buffer.size());
  if (!QueryFullProcessImageNameW(process, 0, buffer.data(), &length)) return L"";
  return std::wstring(buffer.data(), length);
}

static std::wstring ProcessUser(HANDLE process) {
  HANDLE token = nullptr;
  if (!OpenProcessToken(process, TOKEN_QUERY, &token)) return L"";

  DWORD required = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &required);
  if (required == 0) {
    CloseHandle(token);
    return L"";
  }

  std::vector<unsigned char> storage(required);
  if (!GetTokenInformation(token, TokenUser, storage.data(), required, &required)) {
    CloseHandle(token);
    return L"";
  }
  CloseHandle(token);

  const auto* tokenUser = reinterpret_cast<const TOKEN_USER*>(storage.data());
  DWORD nameLength = 0;
  DWORD domainLength = 0;
  SID_NAME_USE use;
  LookupAccountSidW(nullptr, tokenUser->User.Sid, nullptr, &nameLength,
                    nullptr, &domainLength, &use);
  if (nameLength == 0) return L"";

  std::vector<wchar_t> name(nameLength + 1);
  std::vector<wchar_t> domain(domainLength + 1);
  if (!LookupAccountSidW(nullptr, tokenUser->User.Sid, name.data(), &nameLength,
                         domain.data(), &domainLength, &use)) {
    return L"";
  }
  if (domainLength == 0) return std::wstring(name.data(), nameLength);
  return std::wstring(domain.data(), domainLength) + L"\\" +
         std::wstring(name.data(), nameLength);
}

static std::wstring StartedAt(const FILETIME& created) {
  SYSTEMTIME time = {};
  if (!FileTimeToSystemTime(&created, &time)) return L"";
  wchar_t buffer[32] = {};
  swprintf_s(buffer, sizeof(buffer) / sizeof(buffer[0]),
             L"%04u-%02u-%02uT%02u:%02u:%02u.%03uZ",
             time.wYear, time.wMonth, time.wDay, time.wHour, time.wMinute,
             time.wSecond, time.wMilliseconds);
  return buffer;
}

static HANDLE OpenProcessForRead(DWORD pid) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
                               FALSE, pid);
  if (!process) {
    process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  }
  return process;
}

static std::vector<ProcessRow> ReadProcesses(std::string* error) {
  std::lock_guard<std::mutex> stateLock(g_stateMutex);

  FILETIME idleTime = {}, kernelTime = {}, userTime = {};
  const bool haveSystemTime = GetSystemTimes(&idleTime, &kernelTime, &userTime) != FALSE;
  const ULONGLONG systemTime = haveSystemTime
      ? FileTimeValue(kernelTime) + FileTimeValue(userTime)
      : 0;
  const ULONGLONG systemDelta =
      haveSystemTime && g_lastSystemTime > 0 && systemTime >= g_lastSystemTime
          ? systemTime - g_lastSystemTime
          : 0;

  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) {
    *error = "CreateToolhelp32Snapshot falhou.";
    return {};
  }

  std::vector<ProcessRow> rows;
  std::unordered_map<DWORD, ProcessTimes> nextProcessTimes;
  std::unordered_map<DWORD, ProcessMetadata> nextProcessMetadata;
  PROCESSENTRY32W entry = {};
  entry.dwSize = sizeof(entry);

  if (Process32FirstW(snapshot, &entry)) {
    do {
      ProcessRow row;
      row.pid = entry.th32ProcessID;
      row.parentPid = entry.th32ParentProcessID;
      row.name = entry.szExeFile;

      HANDLE process = OpenProcessForRead(row.pid);
      if (process) {
        FILETIME created = {}, exited = {}, processKernel = {}, processUser = {};
        if (GetProcessTimes(process, &created, &exited, &processKernel, &processUser)) {
          ProcessTimes current = {
              FileTimeValue(created), FileTimeValue(processKernel), FileTimeValue(processUser)};
          const auto previous = g_lastProcessTimes.find(row.pid);
          if (systemDelta > 0 && previous != g_lastProcessTimes.end() &&
              previous->second.created == current.created) {
            const ULONGLONG priorCpu = previous->second.kernel + previous->second.user;
            const ULONGLONG currentCpu = current.kernel + current.user;
            if (currentCpu >= priorCpu) {
              row.cpuPercent = std::clamp(
                  100.0 * static_cast<double>(currentCpu - priorCpu) /
                      static_cast<double>(systemDelta),
                  0.0, 100.0);
            }
          }
          nextProcessTimes.emplace(row.pid, current);

          const auto cachedMetadata = g_processMetadata.find(row.pid);
          ProcessMetadata metadata;
          if (cachedMetadata != g_processMetadata.end() &&
              cachedMetadata->second.created == current.created) {
            metadata = cachedMetadata->second;
          } else {
            metadata.created = current.created;
            metadata.started = StartedAt(created);
            metadata.path = ProcessPath(process);
            metadata.user = ProcessUser(process);
          }
          nextProcessMetadata.emplace(row.pid, metadata);
          row.started = metadata.started;
          row.path = metadata.path;
          row.user = metadata.user;
        }

        PROCESS_MEMORY_COUNTERS_EX memory = {};
        memory.cb = sizeof(memory);
        if (GetProcessMemoryInfo(
                process, reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&memory),
                sizeof(memory))) {
          row.memBytes = static_cast<uint64_t>(memory.WorkingSetSize);
        }
        CloseHandle(process);
      }

      rows.emplace_back(std::move(row));
    } while (Process32NextW(snapshot, &entry));
  }

  CloseHandle(snapshot);
  if (haveSystemTime) g_lastSystemTime = systemTime;
  g_lastProcessTimes.swap(nextProcessTimes);
  g_processMetadata.swap(nextProcessMetadata);
  return rows;
}

static void ExecuteRead(napi_env, void* data) {
  auto* context = static_cast<AsyncContext*>(data);
  context->rows = ReadProcesses(&context->error);
}

static void SetStringProperty(napi_env env, napi_value object, const char* name,
                              const std::wstring& value) {
  const std::string utf8 = Utf8(value);
  napi_value jsValue;
  napi_create_string_utf8(env, utf8.c_str(), utf8.size(), &jsValue);
  napi_set_named_property(env, object, name, jsValue);
}

static void CompleteRead(napi_env env, napi_status status, void* data) {
  auto* context = static_cast<AsyncContext*>(data);
  if (status != napi_ok || !context->error.empty()) {
    napi_value message;
    napi_value error;
    const char* text = context->error.empty()
        ? "A leitura dos processos foi cancelada."
        : context->error.c_str();
    napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, nullptr, message, &error);
    napi_reject_deferred(env, context->deferred, error);
  } else {
    napi_value array;
    napi_create_array_with_length(env, context->rows.size(), &array);
    for (size_t i = 0; i < context->rows.size(); ++i) {
      const ProcessRow& row = context->rows[i];
      napi_value item;
      napi_value value;
      napi_create_object(env, &item);

      napi_create_uint32(env, row.pid, &value);
      napi_set_named_property(env, item, "pid", value);
      napi_create_uint32(env, row.parentPid, &value);
      napi_set_named_property(env, item, "parentPid", value);
      napi_create_double(env, row.cpuPercent, &value);
      napi_set_named_property(env, item, "cpuPercent", value);
      napi_create_double(env, static_cast<double>(row.memBytes), &value);
      napi_set_named_property(env, item, "memBytes", value);
      SetStringProperty(env, item, "name", row.name);
      SetStringProperty(env, item, "path", row.path);
      SetStringProperty(env, item, "user", row.user);
      SetStringProperty(env, item, "started", row.started);
      napi_set_element(env, array, static_cast<uint32_t>(i), item);
    }
    napi_resolve_deferred(env, context->deferred, array);
  }

  napi_delete_async_work(env, context->work);
  delete context;
}

static napi_value GetProcesses(napi_env env, napi_callback_info) {
  auto* context = new (std::nothrow) AsyncContext();
  if (!context) {
    napi_throw_error(env, nullptr, "Sem memória para iniciar a leitura de processos.");
    return nullptr;
  }

  napi_value promise;
  napi_status status = napi_create_promise(env, &context->deferred, &promise);
  if (status != napi_ok) {
    delete context;
    napi_throw_error(env, nullptr, "Não foi possível criar a tarefa de leitura de processos.");
    return nullptr;
  }

  napi_value resourceName;
  napi_create_string_utf8(env, "Atlas process snapshot", NAPI_AUTO_LENGTH, &resourceName);
  status = napi_create_async_work(env, nullptr, resourceName, ExecuteRead, CompleteRead,
                                 context, &context->work);
  if (status == napi_ok) status = napi_queue_async_work(env, context->work);
  if (status != napi_ok) {
    if (context->work) napi_delete_async_work(env, context->work);
    napi_value message;
    napi_value error;
    napi_create_string_utf8(env, "Não foi possível enfileirar a leitura de processos.", NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, nullptr, message, &error);
    napi_reject_deferred(env, context->deferred, error);
    delete context;
  }
  return promise;
}

static napi_value Initialize(napi_env env, napi_value exports) {
  napi_value function;
  napi_create_function(env, "getProcesses", NAPI_AUTO_LENGTH, GetProcesses, nullptr,
                       &function);
  napi_set_named_property(env, exports, "getProcesses", function);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
