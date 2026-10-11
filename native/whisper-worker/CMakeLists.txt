cmake_minimum_required(VERSION 3.20)
project(whisper_worker CXX C)

set(CMAKE_CXX_STANDARD 17)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(GGML_METAL ON CACHE BOOL "" FORCE)
set(GGML_METAL_EMBED_LIBRARY ON CACHE BOOL "" FORCE) # no .metal file needed at runtime

add_subdirectory(${WHISPER_DIR} whisper EXCLUDE_FROM_ALL)

add_executable(whisper-worker main.cpp)
target_link_libraries(whisper-worker PRIVATE whisper)
