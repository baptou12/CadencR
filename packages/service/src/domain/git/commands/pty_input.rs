use zeroize::Zeroizing;

/// User-provided authentication input. Its allocation is zeroed as soon as the
/// PTY writer consumes or drops it instead of lingering in allocator memory.
pub struct SensitiveInput(Zeroizing<String>);

impl SensitiveInput {
    pub(crate) fn line(value: String) -> Self {
        let value = Zeroizing::new(value);
        let mut line = Zeroizing::new(String::with_capacity(value.len() + 1));
        line.push_str(&value);
        if !line.ends_with('\n') {
            line.push('\n');
        }
        Self(line)
    }

    #[cfg(test)]
    pub(crate) fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl AsRef<[u8]> for SensitiveInput {
    fn as_ref(&self) -> &[u8] {
        self.0.as_bytes()
    }
}
