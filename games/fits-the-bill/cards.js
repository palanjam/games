// Original card content for Fits the Bill. Prompts are describing words,
// answers are things. Written fresh for this project.

const lines = (text) =>
  text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

export const PROMPTS = lines(`
Sticky
Majestic
Suspicious
Overpriced
Cozy
Ancient
Slippery
Dramatic
Fluffy
Terrifying
Delicious
Embarrassing
Mysterious
Noisy
Lazy
Heroic
Awkward
Glamorous
Soggy
Haunted
Wobbly
Fancy
Grumpy
Lucky
Itchy
Invisible
Enormous
Tiny
Smelly
Hilarious
Forgetful
Brave
Sneaky
Shiny
Rusty
Magnetic
Bouncy
Unstoppable
Hypnotic
Prickly
Legendary
Awkwardly Timed
Surprisingly Heavy
Dangerously Cheesy
Wildly Popular
Oddly Specific
Totally Unnecessary
Completely Fake
Extremely Loud
Perfectly Round
Dressed Up
Left Out in the Rain
Best Enjoyed Warm
Not Safe for Pets
Better With Age
Hard to Explain
Impossible to Fold
Very Well Behaved
Slightly Cursed
Deeply Underrated
Great at Parties
Terrible at Parties
Built to Last
Falling Apart
Surprisingly Graceful
Hopelessly Lost
Dangerously Close to Done
Worth the Wait
Ready for Adventure
Always Late
Never Satisfied
Good for Morale
Bad for Business
Fit for a King
Fit for a Pirate
Strangely Calming
Aggressively Cheerful
Loved by Toddlers
Feared by Cats
Banned from the Library
Welcome at Any Picnic
Wearing a Tiny Hat
Quietly Judging You
Secretly Brilliant
Terribly Sticky
Mildly Alarming
Peaceful
Chaotic
Elegant
Clumsy
Greedy
Generous
Moody
Sleepy
Hungry
Furious
Giddy
Nervous
Confident
Gigantic
Frozen
Burning Hot
Crunchy
Squishy
Salty
Spicy
Sour
Sweet
Bitter
Greasy
Fragile
Indestructible
Rickety
Spooky
Sparkly
Dusty
Muddy
Windy
Foggy
Stormy
Sunny
Medieval
Futuristic
Prehistoric
Royal
Wild
Domestic
Foreign
Secret
Public
Forbidden
Sacred
Cheap
Priceless
Tacky
Classy
Rude
Polite
Wise
Foolish
Dizzy
Speedy
Sluggish
Patient
Impatient
Jealous
Proud
Humble
Shy
Bold
Loyal
Tricky
Honest
Gloomy
Cheerful
Weird
Normal
Famous
Forgotten
Homemade
Handmade
Mass Produced
Worn Out
Brand New
Second Hand
Gift Wrapped
Out of Fashion
Over the Top
Under Pressure
Off the Hook
Out of Control
Easy to Lose
Hard to Swallow
Fun at Weddings
Perfect for Camping
Great in a Crisis
Risky
Cunning
Rowdy
Gentle
Clingy
Rubbery
Stretchy
Pointy
Lumpy
Hairy
Bald
Glittery
Fuzzy
Damp
Tangled
`);

export const ANSWERS = lines(`
A pirate ship
Grandma's knitting
A hot air balloon
A garden gnome
The Great Wall
A traffic cone
A night watchman
A wheelbarrow
Ancient Egypt
A rubber duck
A sleepy sloth
A giant pumpkin
Moon cheese
A medieval knight
A roller coaster
A snowman
A jar of pickles
The Loch Ness monster
A school bus
A trampoline
A karaoke night
A wedding cake
An umbrella
A hedgehog
A cactus
A bowl of spaghetti
A drawbridge
A scarecrow
A vending machine
A bag of marbles
A rainy Monday
A tiny violin
A pair of socks
A snow globe
The Wild West
A cowboy hat
A treasure map
A mad scientist
A lazy cat
A noisy parrot
A bubble bath
A haunted house
A sack of potatoes
A coat rack
A pillow fight
The tooth fairy
A magic carpet
A dragon egg
A fire truck
An ice cream truck
A bouncy castle
A wizard's hat
A garden hose
A paper airplane
A water balloon
A jack-o'-lantern
A birthday candle
A fortune cookie
A campfire story
A lost sock
A pinwheel
A cuckoo clock
A grandfather clock
A rocking chair
A pogo stick
A kazoo
A tuba
An accordion
A bagpipe
A harmonica
A xylophone
A banjo
A trombone
A unicycle
A skateboard
A scooter
A tandem bicycle
A hot tub
A bunk bed
A hammock
A tree house
A sandcastle
An igloo
A log cabin
A windmill
A castle moat
A secret tunnel
A trapdoor
A spiral staircase
An elevator
A revolving door
A fire escape
A picket fence
A welcome mat
A mailbox
A scarecrow's hat
A bird bath
A weather vane
A lawn flamingo
A compost heap
A greenhouse
A vegetable patch
A beehive
A chicken coop
A barn owl
A hay bale
A grumpy llama
A dancing penguin
A confused goose
A wise old owl
A smug cat
A loyal dog
A tiny hamster
A giant tortoise
A blue whale
A giant squid
A friendly dolphin
A sneaky raccoon
A curious otter
A lonely walrus
A sleepy koala
A leaping kangaroo
A proud peacock
A pink flamingo
A chatty toucan
A speedy cheetah
A roaring lion
A towering giraffe
A muddy pig
A clumsy elephant
A shy turtle
A tap-dancing frog
A buzzing bumblebee
A glowing firefly
A busy ant
A garden snail
A spinning spider
A monarch butterfly
A hungry caterpillar
A woolly mammoth
A saber-toothed tiger
A friendly dinosaur
A fire-breathing dragon
A grumpy troll
A helpful elf
A forgetful wizard
A kindly witch
A friendly ghost
A bridge troll
A talking mirror
A fairy godmother
A sea monster
A mermaid
A unicorn
A pot of gold
A rainbow
A shooting star
A full moon
A solar eclipse
A thunderstorm
A tornado
A volcano
An earthquake
A glacier
A desert oasis
A coral reef
A rainforest
A mountain top
A quiet meadow
A foggy marsh
A hidden cave
A waterfall
A frozen lake
A sandy beach
A rocky coast
A tropical island
A floating iceberg
A bubbling hot spring
A field of sunflowers
A bouquet of roses
A single daisy
A bonsai tree
An old oak
A giant redwood
A patch of weeds
A pile of leaves
A bucket of mud
A puddle
A snowdrift
A bag of ice
A cup of cocoa
A plate of pancakes
A slice of pizza
A basket of bread
A wheel of cheese
A bunch of bananas
A watermelon
A bowl of porridge
A pot of stew
A plate of nachos
A hot dog
A cheeseburger
A bowl of noodles
A box of chocolates
A jar of honey
A stack of waffles
A tray of cupcakes
A plate of cookies
A scoop of sorbet
A bag of popcorn
A tub of butter
A cup of tea
A glass of lemonade
A pot of coffee
A loaf of sourdough
A jam doughnut
An apple pie
A fruit salad
A bag of crisps
A pretzel
A burrito
A bowl of cereal
A boiled egg
A fried egg
A baked potato
A mushroom
A head of lettuce
A bunch of carrots
A turnip
A giant onion
A string of sausages
A roast chicken
A turkey dinner
A lobster
A bowl of soup
A sushi roll
A dumpling
A taco
A sandwich
A salad bar
A picnic basket
A candy cane
A lollipop
A gumball machine
A piñata
A birthday party
A surprise party
A tea party
A garden party
A dance floor
A disco ball
A talent show
A school play
A spelling bee
A chess match
A game of tag
A pillow fort
A scavenger hunt
A treasure chest
A tug of war
A three-legged race
A sore loser
A relay race
A marathon runner
A sprinter
A gymnast
A figure skater
A deep sea diver
An astronaut
A mountain climber
A tightrope walker
A circus clown
A juggler
A magician
A sword swallower
A ringmaster
A street performer
A mime
A ventriloquist
A stunt double
A film director
A news anchor
A weather forecaster
A radio host
A librarian
A postal worker
A bus driver
A taxi driver
A pilot
A ship's captain
A train conductor
A lighthouse
A dentist
A doctor
A nurse
A vet
A baker
A butcher
A chef
A waiter
A farmer
A fisherman
A lumberjack
A blacksmith
A carpenter
A plumber
An electrician
A firefighter
A police officer
A detective
A lifeguard
A teacher
A professor
A scientist
An inventor
An architect
A painter
A sculptor
A poet
A novelist
A songwriter
A drummer
A violinist
A choir
An orchestra
A marching band
A town crier
A royal jester
A queen
A king
A prince
A princess
A butler
A knight in armor
A viking
A pharaoh
A gladiator
A samurai
A caveman
A pioneer
An explorer
A pilgrim
A spy
A bandit
A yeti
A sailor
A mountain goat
A messy desk
A tidy bedroom
A full fridge
An empty wallet
A leaky faucet
A squeaky door
A broken clock
A dusty attic
A creepy basement
A comfy sofa
A wobbly table
A flickering candle
A ceiling fan
A bathroom scale
A shower curtain
A toothbrush
A hairbrush
A pair of scissors
A roll of tape
A stapler
A paperclip
A pencil sharpener
A box of crayons
A school backpack
A lunchbox
A pencil case
A chalkboard
A globe
A telescope
A microscope
A magnifying glass
A compass
A map
A suitcase
A passport
A sleeping bag
A camping tent
A flashlight
A pocket knife
A fishing rod
A kayak
A canoe
A rowboat
A submarine
A cruise ship
A raft
A paddle
An anchor
A life jacket
A sailboat
A seagull
A cotton candy cart
A hand-written letter
A birthday card
A thank-you note
A secret diary
A crossword puzzle
A jigsaw puzzle
A twisty cube puzzle
A deck of cards
A pair of dice
A board game
A kite
A yo-yo
A spinning top
A jump rope
A hula hoop
A beach ball
A baseball glove
A soccer ball
A golf cart
A bowling ball
A ping pong table
A diving board
A swimming pool
A water slide
A sprinkler
A garden maze
A park bench
A street lamp
A fire hydrant
A manhole cover
A parking meter
A road sign
A traffic jam
A bridge
A tunnel
A skyscraper
A lemonade stand
A farmers market
A flea market
A shopping cart
A gift shop
A bookshop
A bakery
A museum
A zoo
An aquarium
A theme park
A drive-in cinema
A bowling alley
A public library
A town hall
A village green
A clock tower
A cathedral
A pyramid
A temple
A fortress
A stone circle
A fossil
A meteor
A time capsule
A crystal ball
A magic wand
A spell book
A potion
A broomstick
A cauldron
A suit of armor
A royal crown
A golden throne
A jeweled sword
A battle flag
A catapult
A cannon
A wooden shield
A bow and arrow
A coat of arms
A sundial
A fruit smoothie
A snow day
A summer holiday
A road trip
A family reunion
A long weekend
A power nap
A great escape
A fresh start
A bad idea
A good idea
A lucky penny
A four-leaf clover
A wishing well
A birthday wish
A broken promise
A little white lie
A secret handshake
A bear hug
A high five
A standing ovation
A round of applause
A loud sneeze
A big yawn
A hiccup
A belly laugh
A tickle
A daydream
A nightmare
A midnight snack
A morning stretch
An afternoon nap
A cold shower
A warm blanket
A wet towel
A pile of laundry
A mountain of homework
A tangled necklace
A knotted shoelace
A mismatched pair
A spare key
An old photograph
A family recipe
A hand-me-down coat
A lumpy mattress
A rainy picnic
A flat tire
A parking ticket
Burnt toast
A spilled drink
A sunburn
A paper cut
A stubbed toe
A bad haircut
A fashion disaster
A fancy hat
A feather boa
A tuxedo
A ball gown
A top hat
A scarf
A pair of mittens
A woolly jumper
A rain poncho
A flip flop
A rubber boot
A bow tie
A tiara
A superhero cape
A fake mustache
A clown nose
A pirate's eye patch
A wooden spoon
A pair of goggles
A trusty sidekick
A sneaky villain
A brave hero
A sea serpent
A faithful steed
A talking horse
A friendly robot
A spaceship
A flying saucer
A rocket launch
A lunar rover
A satellite
A black hole
A distant planet
A comet
A galaxy
A nebula
An alien visitor
A time machine
A robot butler
A hover board
A laser beam
A jetpack
A giant magnet
A pair of binoculars
A lightning bolt
A gust of wind
A ray of sunshine
A falling leaf
A rolling stone
A lost balloon
A runaway shopping cart
`);
