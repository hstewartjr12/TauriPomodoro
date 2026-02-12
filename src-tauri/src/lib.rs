use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const STATS_FILE_NAME: &str = "focus_stats.json";
const SCHEMA_VERSION: u8 = 2;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Phase {
    Focus,
    ShortBreak,
    LongBreak,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppSettings {
    focus_seconds: u32,
    short_break_seconds: u32,
    long_break_seconds: u32,
    long_break_every: u32,
    daily_goal_minutes: u32,
    auto_start_next_phase: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            focus_seconds: 1_500,
            short_break_seconds: 300,
            long_break_seconds: 900,
            long_break_every: 4,
            daily_goal_minutes: 100,
            auto_start_next_phase: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AppTotals {
    total_focus_sessions: u32,
    total_focus_seconds: u32,
    total_break_seconds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionRecord {
    id: String,
    phase: Phase,
    started_at: u64,
    ended_at: u64,
    duration_seconds: u32,
    completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppState {
    schema_version: u8,
    settings: AppSettings,
    totals: AppTotals,
    sessions: Vec<SessionRecord>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            settings: AppSettings::default(),
            totals: AppTotals::default(),
            sessions: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacySessionRecord {
    timestamp: String,
    duration: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct LegacyStats {
    total_sessions: u32,
    total_focus_seconds: u32,
    sessions: Vec<LegacySessionRecord>,
}

#[derive(Debug, Clone, Serialize)]
struct AppStateResponse {
    state: AppState,
    warning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct LegacyStatsResponse {
    total_sessions: u32,
    total_focus_seconds: u32,
    sessions: Vec<LegacySessionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavePhaseCompletionPayload {
    phase: Phase,
    started_at: u64,
    ended_at: u64,
    duration_seconds: u32,
    completed: bool,
}

fn now_unix_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Unable to get system time: {error}"))
        .map(|duration| duration.as_secs())
}

fn stats_file_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Unable to create app data directory: {error}"))?;

    Ok(app_data_dir.join(STATS_FILE_NAME))
}

fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    if !(300..=7_200).contains(&settings.focus_seconds) {
        return Err("focus_seconds must be between 300 and 7200.".to_string());
    }

    if !(60..=1_800).contains(&settings.short_break_seconds) {
        return Err("short_break_seconds must be between 60 and 1800.".to_string());
    }

    if !(300..=3_600).contains(&settings.long_break_seconds) {
        return Err("long_break_seconds must be between 300 and 3600.".to_string());
    }

    if !(2..=8).contains(&settings.long_break_every) {
        return Err("long_break_every must be between 2 and 8.".to_string());
    }

    if !(10..=1_440).contains(&settings.daily_goal_minutes) {
        return Err("daily_goal_minutes must be between 10 and 1440.".to_string());
    }

    Ok(())
}

fn sanitize_state(state: &mut AppState) -> Option<String> {
    let mut warning: Option<String> = None;

    if state.schema_version != SCHEMA_VERSION {
        state.schema_version = SCHEMA_VERSION;
        warning = Some("Unsupported schema version was normalized to v2 defaults.".to_string());
    }

    if state.settings.auto_start_next_phase {
        state.settings.auto_start_next_phase = false;
        warning = Some("auto_start_next_phase is fixed to false in this build.".to_string());
    }

    if validate_settings(&state.settings).is_err() {
        state.settings = AppSettings::default();
        warning = Some("Invalid settings were reset to defaults.".to_string());
    }

    warning
}

fn atomic_write_state(path: &Path, state: &AppState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create state directory: {error}"))?;
    }

    let payload = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("Unable to serialize state JSON: {error}"))?;

    let stamp = now_unix_seconds()?;
    let tmp_path = path.with_extension(format!("tmp.{stamp}"));

    fs::write(&tmp_path, payload)
        .map_err(|error| format!("Unable to write temp state file: {error}"))?;

    match fs::rename(&tmp_path, path) {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            fs::copy(&tmp_path, path).map_err(|copy_error| {
                format!(
                    "Unable to complete atomic write ({rename_error}); copy failed: {copy_error}"
                )
            })?;
            fs::remove_file(&tmp_path).map_err(|cleanup_error| {
                format!("State copied but temp cleanup failed: {cleanup_error}")
            })?;
            Ok(())
        }
    }
}

fn parse_unix_seconds(input: &str) -> Option<u64> {
    input.parse::<u64>().ok()
}

fn migrate_legacy_stats(legacy: LegacyStats) -> AppState {
    let sessions = legacy
        .sessions
        .into_iter()
        .enumerate()
        .map(|(index, session)| {
            let ended_at = parse_unix_seconds(&session.timestamp).unwrap_or(0);
            let started_at = ended_at.saturating_sub(session.duration as u64);

            SessionRecord {
                id: format!("legacy-{}", index + 1),
                phase: Phase::Focus,
                started_at,
                ended_at,
                duration_seconds: session.duration,
                completed: true,
            }
        })
        .collect();

    AppState {
        schema_version: SCHEMA_VERSION,
        settings: AppSettings::default(),
        totals: AppTotals {
            total_focus_sessions: legacy.total_sessions,
            total_focus_seconds: legacy.total_focus_seconds,
            total_break_seconds: 0,
        },
        sessions,
    }
}

fn load_or_recover_state(path: &Path) -> Result<AppStateResponse, String> {
    if !path.exists() {
        let state = AppState::default();
        atomic_write_state(path, &state)?;
        return Ok(AppStateResponse {
            state,
            warning: None,
        });
    }

    let contents =
        fs::read_to_string(path).map_err(|error| format!("Unable to read stats file: {error}"))?;

    if let Ok(mut state) = serde_json::from_str::<AppState>(&contents) {
        let warning = sanitize_state(&mut state);
        if warning.is_some() {
            atomic_write_state(path, &state)?;
        }

        return Ok(AppStateResponse { state, warning });
    }

    if let Ok(legacy) = serde_json::from_str::<LegacyStats>(&contents) {
        let state = migrate_legacy_stats(legacy);
        atomic_write_state(path, &state)?;
        return Ok(AppStateResponse {
            state,
            warning: Some("Legacy stats were migrated to schema v2.".to_string()),
        });
    }

    let stamp = now_unix_seconds()?;
    let corrupt_file_name = format!("focus_stats.corrupt.{stamp}.json");
    let corrupt_path = path.with_file_name(corrupt_file_name.clone());

    if fs::rename(path, &corrupt_path).is_err() {
        fs::copy(path, &corrupt_path)
            .map_err(|error| format!("Unable to back up malformed stats file: {error}"))?;
        fs::remove_file(path)
            .map_err(|error| format!("Unable to replace malformed stats file: {error}"))?;
    }

    let state = AppState::default();
    atomic_write_state(path, &state)?;

    Ok(AppStateResponse {
        state,
        warning: Some(format!(
            "Malformed stats file was reset. Backup saved as {corrupt_file_name}."
        )),
    })
}

fn validate_phase_completion(payload: &SavePhaseCompletionPayload) -> Result<(), String> {
    if payload.duration_seconds == 0 {
        return Err("duration_seconds must be greater than 0.".to_string());
    }

    if payload.duration_seconds > 86_400 {
        return Err("duration_seconds must be <= 86400.".to_string());
    }

    if payload.ended_at < payload.started_at {
        return Err("ended_at must be greater than or equal to started_at.".to_string());
    }

    Ok(())
}

fn save_phase_completion_at_path(
    path: &Path,
    payload: SavePhaseCompletionPayload,
) -> Result<AppStateResponse, String> {
    validate_phase_completion(&payload)?;

    let mut response = load_or_recover_state(path)?;
    let state = &mut response.state;

    let session_id = format!("{}-{}", payload.ended_at, state.sessions.len() + 1);
    state.sessions.push(SessionRecord {
        id: session_id,
        phase: payload.phase,
        started_at: payload.started_at,
        ended_at: payload.ended_at,
        duration_seconds: payload.duration_seconds,
        completed: payload.completed,
    });

    if payload.completed {
        match payload.phase {
            Phase::Focus => {
                state.totals.total_focus_sessions =
                    state.totals.total_focus_sessions.saturating_add(1);
                state.totals.total_focus_seconds = state
                    .totals
                    .total_focus_seconds
                    .saturating_add(payload.duration_seconds);
            }
            Phase::ShortBreak | Phase::LongBreak => {
                state.totals.total_break_seconds = state
                    .totals
                    .total_break_seconds
                    .saturating_add(payload.duration_seconds);
            }
        }
    }

    atomic_write_state(path, state)?;
    Ok(response)
}

fn save_settings_at_path(path: &Path, mut settings: AppSettings) -> Result<(), String> {
    settings.auto_start_next_phase = false;
    validate_settings(&settings)?;

    let mut response = load_or_recover_state(path)?;
    response.state.settings = settings;
    atomic_write_state(path, &response.state)
}

fn to_legacy_stats(state: &AppState) -> LegacyStatsResponse {
    let sessions = state
        .sessions
        .iter()
        .filter(|session| session.phase == Phase::Focus && session.completed)
        .map(|session| LegacySessionRecord {
            timestamp: session.ended_at.to_string(),
            duration: session.duration_seconds,
        })
        .collect();

    LegacyStatsResponse {
        total_sessions: state.totals.total_focus_sessions,
        total_focus_seconds: state.totals.total_focus_seconds,
        sessions,
    }
}

#[tauri::command]
fn load_stats(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = stats_file_path(&app_handle)?;
    let response = load_or_recover_state(&path)?;
    let legacy = to_legacy_stats(&response.state);
    serde_json::to_string(&legacy)
        .map_err(|error| format!("Unable to serialize legacy stats: {error}"))
}

#[tauri::command]
fn save_session(app_handle: tauri::AppHandle, duration: u32) -> Result<(), String> {
    if duration == 0 {
        return Err("Session duration must be greater than 0.".to_string());
    }

    let ended_at = now_unix_seconds()?;
    let payload = SavePhaseCompletionPayload {
        phase: Phase::Focus,
        started_at: ended_at.saturating_sub(duration as u64),
        ended_at,
        duration_seconds: duration,
        completed: true,
    };

    let path = stats_file_path(&app_handle)?;
    let _ = save_phase_completion_at_path(&path, payload)?;
    Ok(())
}

#[tauri::command]
fn load_app_state(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = stats_file_path(&app_handle)?;
    let response = load_or_recover_state(&path)?;
    serde_json::to_string(&response)
        .map_err(|error| format!("Unable to serialize app state response: {error}"))
}

#[tauri::command]
fn save_phase_completion(
    app_handle: tauri::AppHandle,
    payload_json: String,
) -> Result<String, String> {
    let payload: SavePhaseCompletionPayload = serde_json::from_str(&payload_json)
        .map_err(|error| format!("Invalid phase completion payload: {error}"))?;

    let path = stats_file_path(&app_handle)?;
    let response = save_phase_completion_at_path(&path, payload)?;
    serde_json::to_string(&response)
        .map_err(|error| format!("Unable to serialize app state response: {error}"))
}

#[tauri::command]
fn save_settings(app_handle: tauri::AppHandle, payload_json: String) -> Result<(), String> {
    let settings: AppSettings = serde_json::from_str(&payload_json)
        .map_err(|error| format!("Invalid settings payload: {error}"))?;

    let path = stats_file_path(&app_handle)?;
    save_settings_at_path(&path, settings)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            save_session,
            load_stats,
            load_app_state,
            save_phase_completion,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn unique_test_path(prefix: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();

        env::temp_dir().join(format!("focusforge-{prefix}-{stamp}.json"))
    }

    #[test]
    fn migrates_legacy_stats_to_v2() {
        let path = unique_test_path("migrate");
        let legacy = r#"{
          "total_sessions": 3,
          "total_focus_seconds": 4500,
          "sessions": [
            { "timestamp": "1700000000", "duration": 1500 },
            { "timestamp": "1700003600", "duration": 1500 },
            { "timestamp": "1700007200", "duration": 1500 }
          ]
        }"#;

        fs::write(&path, legacy).expect("write legacy");

        let response = load_or_recover_state(&path).expect("load state");
        assert_eq!(response.state.schema_version, 2);
        assert_eq!(response.state.totals.total_focus_sessions, 3);
        assert_eq!(response.state.totals.total_focus_seconds, 4500);
        assert_eq!(response.state.sessions.len(), 3);
        assert!(response.warning.is_some());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn missing_file_returns_default_v2() {
        let path = unique_test_path("missing");
        let _ = fs::remove_file(&path);

        let response = load_or_recover_state(&path).expect("load default");
        assert_eq!(response.state.schema_version, 2);
        assert_eq!(response.state.totals.total_focus_sessions, 0);
        assert!(path.exists());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn malformed_file_is_backed_up_and_reset() {
        let path = unique_test_path("malformed");
        fs::write(&path, "{ definitely_not_json }").expect("write malformed");

        let response = load_or_recover_state(&path).expect("recover state");
        assert_eq!(response.state.schema_version, 2);
        assert!(response.warning.is_some());

        let dir = path.parent().expect("parent");
        let backup_found = fs::read_dir(dir).expect("read dir").flatten().any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("focus_stats.corrupt.")
        });

        assert!(backup_found);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn phase_completion_updates_totals() {
        let path = unique_test_path("phase-complete");

        let payload = SavePhaseCompletionPayload {
            phase: Phase::Focus,
            started_at: 1_700_000_000,
            ended_at: 1_700_001_500,
            duration_seconds: 1_500,
            completed: true,
        };

        let response = save_phase_completion_at_path(&path, payload).expect("save completion");
        assert_eq!(response.state.totals.total_focus_sessions, 1);
        assert_eq!(response.state.totals.total_focus_seconds, 1_500);
        assert_eq!(response.state.totals.total_break_seconds, 0);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn repeated_writes_keep_valid_state() {
        let path = unique_test_path("atomic");

        for index in 0..5 {
            let payload = SavePhaseCompletionPayload {
                phase: Phase::Focus,
                started_at: 1_700_000_000 + (index * 1_600),
                ended_at: 1_700_001_500 + (index * 1_600),
                duration_seconds: 1_500,
                completed: true,
            };

            save_phase_completion_at_path(&path, payload).expect("write loop");
        }

        let response = load_or_recover_state(&path).expect("reload final state");
        assert_eq!(response.state.totals.total_focus_sessions, 5);
        assert_eq!(response.state.sessions.len(), 5);

        let _ = fs::remove_file(path);
    }
}
