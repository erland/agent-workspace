#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Tauri application context should be constructible");
}

#[cfg(test)]
mod tests {
    #[test]
    fn rust_test_is_executed() {
        assert_eq!(2 + 2, 4);
    }
}
