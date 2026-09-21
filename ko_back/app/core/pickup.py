from datetime import datetime, time, timedelta

# Horario de la tienda (mismo que el footer y core/utils/pickup-slots.ts del front).
# weekday(): lunes = 0 … domingo = 6. El lunes está cerrado.
OPENING_HOURS: dict[int, tuple[time, time]] = {
    **{day: (time(8, 30), time(20, 0)) for day in (1, 2, 3, 4)},
    **{day: (time(9, 0), time(21, 0)) for day in (5, 6)},
}
SLOT_MINUTES = 30
PICKUP_FORMAT = "%Y-%m-%dT%H:%M"


def validate_pickup_time(value: str) -> str:
    """Comprueba que el retiro sea un tramo real dentro del horario de apertura."""
    try:
        moment = datetime.strptime(value, PICKUP_FORMAT)
    except ValueError:
        raise ValueError("Horario de retiro no válido: usa el formato AAAA-MM-DDTHH:MM") from None

    hours = OPENING_HOURS.get(moment.weekday())
    if hours is None:
        raise ValueError("La tienda está cerrada los lunes")
    if moment.minute % SLOT_MINUTES != 0:
        raise ValueError(f"El retiro debe ser en tramos de {SLOT_MINUTES} minutos")

    opens, closes = hours
    last_slot = datetime.combine(moment.date(), closes) - timedelta(minutes=SLOT_MINUTES)
    if moment.time() < opens or moment > last_slot:
        raise ValueError(f"Fuera de horario: ese día se retira de {opens:%H:%M} a {closes:%H:%M}")
    return value
