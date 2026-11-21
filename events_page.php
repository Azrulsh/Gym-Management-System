<?php
declare(strict_types=1);
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/events_repository.php';

/** Load before rendering controls so failed reads never leave a usable partial form. */
function events_page_load(callable $load): ?array
{
    try {
        include __DIR__ . '/db_connect.php';
        return $load(new EventsRepository($conn));
    } catch (EventRequestException $exception) {
        http_response_code($exception->status);
        echo '<div class="container-fluid py-3"><div class="alert alert-warning" role="alert">' . event_escape($exception->getMessage()) . '</div><a href="index.php?page=events">Back to Events</a></div>';
    } catch (mysqli_sql_exception | RuntimeException $exception) {
        error_log('Events read unavailable (code ' . (int)$exception->getCode() . ').');
        http_response_code(503);
        echo '<div class="container-fluid py-3"><div class="alert alert-danger" role="alert">Unable to load Events. Please try again.</div></div>';
    } finally { if (isset($conn)) $conn->close(); }
    return null;
}

function event_datetime_input(?string $value): string
{
    return $value === null ? '' : str_replace(' ', 'T', substr($value,0,16));
}

function event_time_label(string $value): string
{
    return (new DateTimeImmutable($value))->format('d M Y, g:i A');
}

function events_script(): void
{
    echo '<script src="assets/js/events.js?v=' . (int)filemtime(__DIR__ . '/assets/js/events.js') . '"></script>';
}
