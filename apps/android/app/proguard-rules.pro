# Release (R8) rules of the reference shell. :platform-core ships its own consumer rules
# (kotlinx.serialization, OkHttp, androidbrowserhelper, security-crypto).

# Activities and services are referenced from the manifest (kept by AAPT); nothing else
# in the shell is looked up by name.
