$ErrorActionPreference = "Stop"
$baseUrl = "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image"
$outDir = "d:\Ai_Program_Files\XTSQLQueryAgent\docs\images"

$diagrams = @(
  @{
    Name = "01-quick-start"
    Size = "landscape_16_9"
    Prompt = "A clean professional horizontal flowchart diagram for technical documentation. White background, minimalist flat design. Title at top center: 'XTSQLQueryAgent Quick Flow'. Main flow: 5 blue (#3B82F6) rounded rectangles connected by black arrows reading left to right with labels: 'User Question' then 'POST /api/query/generate' then 'SSE Stream' then 'Done Event with SQL output' then 'Frontend Display'. Below main flow: 5 gray (#6B7280) smaller rounded rectangles as annotations showing internal processing steps: 'loadMessagesFromDb', 'while maxToolCalls loop', 'checklist plus compact plus prune', 'fetch DeepSeek API', '3-phase tool execution'. Dashed gray arrows connect annotations to corresponding main flow boxes. Modern flat design, dark text on white background, sans-serif font, technical documentation style, landscape orientation."
  },
  @{
    Name = "02-three-phase-execution"
    Size = "portrait_16_9"
    Prompt = "A detailed professional vertical flowchart diagram for technical documentation. White background, clean minimalist style. Title at top in dark text: 'Tool Execution Three-Phase Flow'. Three large horizontal sections separated by colored divider bars. SECTION 1 (top section, blue #3B82F6 header bar): 'PHASE 1 - PREPARE (Synchronous)'. Inside: input box 'validToolCalls from LLM' then 'JSON.parse arguments' then diamond decision 'parseError' with red error path leading to 'execError parameter parse failed' then 'Check toolsMap exists' then 'Check availableTools not pruned' then 'dupCheck duplicate call check' then arrow down to Section 2. SECTION 2 (middle section, green #10B981 header bar): 'PHASE 2 - Promise.all (Parallel IO)'. Inside: 'await tool.func execute' then diamond 'is validate_sql_fields' with green yes path to 'write reg.validateSqlFields Called Passed ErrorCount' then 'recordToolCall write to registry' then arrow down to Section 3. SECTION 3 (bottom section, orange #F59E0B header bar): 'PHASE 3 - Write-back (Original Order)'. Inside: 'Loop by validToolCalls original order' then diamond 'dupCheck blocked' with red yes path to 'push duplicate block message' then diamond 'execError occurred' with red yes path to 'push Error message' then green no path to 'push normal result content' then diamond 'is request_user_choice' with green yes path to 'pendingUserChoiceList push' then 'break loop yield done'. Use blue #3B82F6 for normal flow boxes, red #EF4444 for error paths and labels, green #10B981 for success paths, gray #6B7280 for connector lines, white background, black sans-serif text. Decision diamonds for conditionals, rounded rectangles for processes. Portrait orientation suitable for vertical scroll, technical documentation style."
  },
  @{
    Name = "03-state-machine"
    Size = "landscape_16_9"
    Prompt = "A professional state machine diagram for technical documentation. White background, clean minimalist style. Title at top: 'Session Registry State Machine'. Two main parts. PART 1 (upper half): A large outer rectangle with rounded corners labeled 'sessionToolRegistries Map sessionId to reg'. Inside this container: 3 small blue (#3B82F6) rounded rectangle sub-states connected by arrows: 'getOrCreateRegistry' on left, 'Reg exists (Map.has returned)' on top right, 'Reg new (created)' on bottom right. An arrow from the container to the right labeled 'clearSessionRegistry' (red #EF4444) leading to a small dashed rectangle labeled 'Removed from Map'. PART 2 (lower half): Two grouped boxes side by side. Left box with blue (#3B82F6) header bar labeled 'Session-level persistent fields': contains 7 small light-blue rounded rectangles stacked vertically listing 'getDomainIndexCalled bool', 'slicedDomains Set', 'tableSchema Set', 'tableDdl Set', 'termConfirmed Set', 'userChoiceAsked Map', 'getTablesCalled bool'. Right box with orange (#F59E0B) header bar labeled 'Per-question reset fields': contains 3 small light-orange rounded rectangles 'validateSqlFieldsCalled bool', 'validateSqlFieldsPassed bool', 'validateSqlFieldsErrorCount number'. Below right box: small state cycle diagram with arrows: 'Reset state' to 'LlmCall validate' to 'Pass' (green) or 'Fail' (red) to 'loop back to LlmCall' or 'exit to SQL output'. Use blue #3B82F6 for session-level, orange #F59E0B for per-question, red #EF4444 for removal and failure, green #10B981 for success, white background, black text, sans-serif font. Landscape orientation, technical documentation style."
  },
  @{
    Name = "04-registry-readwrite"
    Size = "landscape_16_9"
    Prompt = "A clean professional horizontal flowchart for technical documentation. White background, minimalist flat design. Title at top center: 'Registry Read and Write Operations'. Center: A green (#10B981) cylinder or database icon labeled 'reg session registry object'. Left side has a vertical label 'READ operations' in blue (#3B82F6). Three blue rounded rectangles stacked vertically on the left: top one 'buildToolCallChecklistMessage' with small annotation 'uses all fields', middle one 'prune tools' with annotation 'uses getDomainIndexCalled, slicedDomains', bottom one 'checkAndFilterDuplicateCall' with annotation 'uses userChoiceAsked, termConfirmed, tableSchema, tableDdl'. Blue arrows from each of the three boxes point right to the center reg icon. Right side has a vertical label 'WRITE operations' in green (#10B981). Two green rounded rectangles stacked vertically on the right: top one 'recordToolCall all tools' with annotation 'writes to userChoiceAsked and others', bottom one 'validate_sql_fields special handling' with annotation 'writes validateSqlFieldsCalled Passed ErrorCount'. Green arrows from these boxes point left to the center reg icon. Color scheme: blue #3B82F6 for read operations, green #10B981 for write operations and center, white background, black text, sans-serif font, landscape orientation, technical documentation style."
  },
  @{
    Name = "05-persistence-dualtrack"
    Size = "landscape_16_9"
    Prompt = "A clean professional horizontal flowchart for technical documentation. White background, minimalist flat design. Title at top center: 'Message Persistence: Dual Track Architecture'. Center: Large blue (#3B82F6) rounded rectangle labeled 'messages array in-memory single source of truth' with role list inside as small white pills: 'system, user, assistant, tool_calls, tool'. Left side: Cyan (#06B6D4) cylinder database icon labeled 'llm_messages table (SQLite)' with 4 small labels around it: 'session_id primary key', 'messages JSON blob', 'message_tokens cumulative', 'updated_at timestamp'. A solid blue arrow from center to left labeled 'saveMessagesToDb after each assistantMsg'. A dashed blue arrow from left back to center labeled 'loadMessagesFromDb on new user message'. Right side: Orange (#F59E0B) cylinder database icon labeled 'messages table (SQLite)' with small role list labels: 'user, assistant, LLM, tool, tool_return, usage'. A solid orange arrow from center to right labeled 'per-SSE-event plus final store'. Far right: smaller gray (#6B7280) dashed rounded rectangle labeled 'lastMessages process memory debug only' with a dashed gray arrow from center labeled 'JSON.parse plus JSON.stringify'. Color scheme: blue #3B82F6 for center, cyan #06B6D4 for llm_messages, orange #F59E0B for messages table, gray #6B7280 for lastMessages, white background, black text, sans-serif font, landscape orientation, technical documentation style."
  }
)

function Get-ImageFromApi {
  param([string]$Prompt, [string]$Size, [string]$OutFile)
  Add-Type -AssemblyName System.Web
  $encoded = [System.Web.HttpUtility]::UrlEncode($Prompt)
  $url = "${baseUrl}?prompt=${encoded}&image_size=${Size}"
  Write-Host "  URL length: $($url.Length)"
  $request = [System.Net.HttpWebRequest]::Create($url)
  $request.Method = "GET"
  $request.Timeout = 120000
  $request.ReadWriteTimeout = 120000
  $request.UserAgent = "PowerShell/5.1"
  $request.KeepAlive = $false
  try {
    $response = $request.GetResponse()
    $stream = $response.GetResponseStream()
    $fs = [System.IO.File]::Create($OutFile)
    $stream.CopyTo($fs)
    $fs.Close()
    $stream.Close()
    $response.Close()
    $file = Get-Item $OutFile
    return $file.Length
  } catch {
    $ex = $_.Exception
    if ($ex.Response) {
      $stream = $ex.Response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $body = $reader.ReadToEnd()
      throw "HTTP error: $body"
    }
    throw
  }
}

$results = @()
foreach ($d in $diagrams) {
  $outFile = Join-Path $outDir "$($d.Name).jpg"
  Write-Host "[$($d.Name)] Generating..." -ForegroundColor Cyan
  try {
    $size = Get-ImageFromApi -Prompt $d.Prompt -Size $d.Size -OutFile $outFile
    $results += @{ Name = $d.Name; Size = $size; Path = $outFile }
    Write-Host "  OK: $size bytes -> $outFile" -ForegroundColor Green
  } catch {
    $results += @{ Name = $d.Name; Size = 0; Error = $_.Exception.Message }
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
  }
}

Write-Host "`n=== Summary ===" -ForegroundColor Yellow
$results | ForEach-Object {
  if ($_.Size -gt 0) {
    Write-Host "  $($_.Name): $($_.Size) bytes" -ForegroundColor Green
  } else {
    Write-Host "  $($_.Name): FAILED - $($_.Error)" -ForegroundColor Red
  }
}
